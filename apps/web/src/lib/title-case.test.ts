/**
 * Names are Title Case: every word starts with a capital, small words too
 * ("From The Blog", "Connect A Channel", "Start From Blank"). That is the rule
 * the owner set on 2026-10-22 for headings, card names, dialog titles, buttons,
 * tabs, menu items and table headers, across the whole app.
 *
 * What it does NOT cover: sentences. Descriptions, tooltips that explain,
 * banners, errors, toasts and empty-state messages stay sentence case, and so
 * do form field labels (design-system-rules.md section 1). A *message* that
 * sits where a name would ("Delete this post?", "Couldn't load the team",
 * "No channels yet") is a sentence too, so it is skipped: it ends in . ? ! : or
 * an ellipsis, or it opens the way a sentence does ("No", "Couldn't", "You",
 * "The"). A contraction alone does not make a message: "Let's Start" is a
 * button.
 *
 * ## How it checks
 *
 * It parses every `.tsx` under `apps/web/src` and `packages/ui/src` with the
 * TypeScript compiler (not a regex, so a multi-line button label or a ternary
 * is read properly) and reads the static text of the elements in `NAME_TAGS`,
 * plus the `title` and `label` props in `NAME_PROPS`. CSS `capitalize` is not an
 * option: it would also capitalise the user's own words, so the source text
 * itself has to be right.
 *
 * ## When it fails
 *
 * The message lists every offender as `file:line "text"`. Fix the text. If the
 * text is really not a name (a brand, a code word), add it to `ALLOWED` with a
 * reason; do not weaken the rule.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SCAN = ['apps/web/src', 'packages/ui/src'];

/** The playground shows sample copy, not the product's own. */
const SKIP_PATHS = ['apps/web/src/app/dev/'];

/** Elements whose static text is a name: a heading, a title, something you press. */
const NAME_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'th',
  'Heading',
  'Badge',
  'DialogTitle',
  'AlertDialogTitle',
  'SheetTitle',
  'CardTitle',
  'Button',
  'ActionLink',
  'TabsTrigger',
  'DropdownMenuItem',
  'DropdownMenuLabel',
  'ContextMenuItem',
  'TableHead',
  'AlertDialogAction',
  'AlertDialogCancel',
  'ToastAction',
  'DialogTrigger',
]);

/** `<Tag prop="...">`: props whose value is a name. */
const NAME_PROPS: Record<string, string[]> = {
  HomeSection: ['title'],
  SectionHeader: ['title'],
  TooltipHint: ['label'],
  CommandGroup: ['heading'],
  StatCard: ['label'],
  MetricCard: ['label'],
};

/** `<Tag action={{ label: '...' }}>`: the button inside a state message. */
const ACTION_TAGS = new Set(['EmptyState', 'ErrorState', 'SuccessState']);

/**
 * Text that is allowed to stay as written, by `file :: text`. Each needs a
 * reason; the list is meant to stay short.
 */
const ALLOWED: Record<string, string> = {
  'apps/web/src/components/onboarding/welcome-screen.tsx :: Hey there, X Welcome To PostGear':
    'A greeting is a sentence, like Home\'s "Good evening, Demo"; the second line is Title Case.',
  'apps/web/src/components/onboarding/welcome-screen.tsx :: Hey there X Welcome To PostGear':
    'The same greeting before the name is known.',
  'apps/web/src/components/appearance/appearance-settings.tsx :: X is a premium theme':
    'A statement about the theme being previewed ("Grape is a premium theme"), not a name.',
  'apps/web/src/components/composer/media-picker-dialog.tsx :: Already attached to this part':
    'Says why a media tile is disabled: a status, not the name of an action.',
};

/** A message, not a name: skipped. */
export function isMessage(text: string): boolean {
  if (/[.?!:…]$/.test(text) || text.includes('…')) return true;
  if (/^(No|Not|Nothing|Couldn|Could not|We|Your|You|There|This|That|The|Please)\b/.test(text)) {
    return true;
  }
  return false;
}

/** Every word that starts with a letter starts with a capital. */
export function isTitleCase(text: string): boolean {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      const first = word.replace(/^[^A-Za-z0-9]+/, '')[0];
      // Numbers, symbols and words with no letter to start with are fine.
      if (!first || !/[A-Za-z]/.test(first)) return true;
      return first === first.toUpperCase();
    });
}

interface Offender {
  where: string;
  text: string;
}

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === 'node_modules' || entry === '.next' ? [] : files(path);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

/** String literals a JSX expression can show: both branches of a ternary, `&&` and `||` operands. */
function literals(node: ts.Node | undefined): ts.StringLiteralLike[] {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return literals(node.right);
    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...literals(node.left), ...literals(node.right)];
    }
  }
  return [];
}

function tagName(element: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.tagName.getText();
}

function attributes(element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes {
  return (ts.isJsxElement(element) ? element.openingElement : element).attributes;
}

/**
 * A dynamic value inside a name ("Customize for {channel}"): stands in as a
 * capitalised word, since it is the user's own text and not ours to judge.
 */
const VALUE = 'X';

/** Most variants one element is read as (every ternary doubles them). */
const MAX_VARIANTS = 32;

/** Every way a run of parts can read: one choice per part, joined. */
function combine(parts: string[][]): string[] {
  return parts
    .reduce<string[]>(
      (variants, choices) =>
        variants
          .flatMap((start) => choices.map((choice) => `${start} ${choice}`))
          .slice(0, MAX_VARIANTS),
      [''],
    )
    .map((variant) => variant.replace(/\s+/g, ' ').trim());
}

/** What a JSX expression can show: each branch of a ternary, nothing for `null`, a value otherwise. */
function expressionChoices(node: ts.Node | undefined, sourceFile: ts.SourceFile): string[] {
  if (!node) return [''];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    // `Hey there, ${name}`: the literal parts with what each slot can show
    // between them, so `${n === 1 ? 'credit' : 'credits'}` is read as words.
    return node.templateSpans.reduce<string[]>(
      (variants, span) =>
        variants
          .flatMap((start) =>
            expressionChoices(span.expression, sourceFile).map(
              (choice) => `${start}${choice}${span.literal.text}`,
            ),
          )
          .slice(0, MAX_VARIANTS),
      [node.head.text],
    );
  }
  if (ts.isParenthesizedExpression(node)) return expressionChoices(node.expression, sourceFile);
  if (ts.isConditionalExpression(node)) {
    return [
      ...expressionChoices(node.whenTrue, sourceFile),
      ...expressionChoices(node.whenFalse, sourceFile),
    ];
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return [...expressionChoices(node.right, sourceFile), ''];
    }
    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...expressionChoices(node.left, sourceFile),
        ...expressionChoices(node.right, sourceFile),
      ];
    }
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node))
    return readChildren(node.children, sourceFile);
  if (ts.isJsxSelfClosingElement(node)) return [''];
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(node) && node.text === 'undefined')
  ) {
    return [''];
  }
  return [VALUE];
}

/** Every way an element's children can read, as whole strings. */
function readChildren(children: ts.NodeArray<ts.JsxChild>, sourceFile: ts.SourceFile): string[] {
  const parts: string[][] = [];

  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = child
        .getText(sourceFile)
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (text) parts.push([text]);
    } else if (ts.isJsxExpression(child)) {
      parts.push(expressionChoices(child.expression, sourceFile));
    } else if (ts.isJsxElement(child) || ts.isJsxFragment(child)) {
      parts.push(readChildren(child.children, sourceFile));
    }
    // A self-closing child (an icon) shows no text.
  }

  return combine(parts);
}

/** The text an element shows, as every variant it can read as. */
function childText(element: ts.JsxElement, sourceFile: ts.SourceFile): string[] {
  return readChildren(element.children, sourceFile).filter(Boolean);
}

function check(text: string, where: string, offenders: Offender[]) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || !/\s/.test(clean)) return; // one word: a capital or a brand, nothing to join
  if (isMessage(clean) || isTitleCase(clean)) return;
  if (ALLOWED[`${where.split(':')[0]} :: ${clean}`]) return;
  offenders.push({ where, text: clean });
}

export function offendersIn(path: string, source: string): Offender[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const offenders: Offender[] = [];
  const at = (node: ts.Node) =>
    `${path}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node);

      if (ts.isJsxElement(node) && NAME_TAGS.has(name)) {
        for (const text of childText(node, sourceFile)) check(text, at(node), offenders);
      }

      for (const attribute of attributes(node).properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
        const prop = attribute.name.getText(sourceFile);

        if (NAME_PROPS[name]?.includes(prop)) {
          const value = ts.isStringLiteral(attribute.initializer)
            ? [attribute.initializer]
            : ts.isJsxExpression(attribute.initializer)
              ? literals(attribute.initializer.expression)
              : [];
          for (const literal of value) check(literal.text, at(attribute), offenders);
        }
      }

      // The button inside a state message, however it is passed:
      // `action={{ label }}`, `action={cond ? { label } : undefined}`, or
      // spread in with `{...(cond ? { action: { label } } : {})}`.
      if (ACTION_TAGS.has(name)) {
        const findLabels = (inner: ts.Node, inAction: boolean) => {
          if (ts.isJsxAttribute(inner)) {
            const prop = inner.name.getText(sourceFile);
            if (inner.initializer) findLabels(inner.initializer, prop === 'action');
            return;
          }
          if (ts.isPropertyAssignment(inner)) {
            const key = inner.name.getText(sourceFile);
            if (key === 'label' && inAction) {
              for (const literal of literals(inner.initializer))
                check(literal.text, at(inner), offenders);
              return;
            }
            findLabels(inner.initializer, key === 'action' || (inAction && key !== 'label'));
            return;
          }
          ts.forEachChild(inner, (child) => findLabels(child, inAction));
        };
        findLabels(attributes(node), false);
      }

      // An icon button's `aria-label` is the name a screen reader says, so it
      // reads like the tooltip that names it: "Insert Signature" in both.
      if (name === 'TooltipHint' && ts.isJsxElement(node)) {
        const tip = attributes(node).properties.find(
          (attribute): attribute is ts.JsxAttribute =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'label',
        )?.initializer;
        const findAria = (inner: ts.Node) => {
          if (
            ts.isJsxAttribute(inner) &&
            inner.name.getText(sourceFile) === 'aria-label' &&
            inner.initializer &&
            ts.isStringLiteral(inner.initializer) &&
            tip &&
            ts.isStringLiteral(tip)
          ) {
            const aria = inner.initializer.text;
            if (aria !== tip.text && aria.toLowerCase() === tip.text.toLowerCase()) {
              offenders.push({ where: at(inner), text: aria });
            }
          }
          ts.forEachChild(inner, findAria);
        };
        node.children.forEach(findAria);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return offenders;
}

describe('isTitleCase', () => {
  it('wants a capital on every word, small words included', () => {
    expect(isTitleCase('From The Blog')).toBe(true);
    expect(isTitleCase('Connect A Channel')).toBe(true);
    expect(isTitleCase('From the Blog')).toBe(false);
    expect(isTitleCase('Create post')).toBe(false);
  });

  it('lets numbers, symbols and acronyms through', () => {
    expect(isTitleCase('Generate With AI')).toBe(true);
    expect(isTitleCase('Step 1 Of 3')).toBe(true);
    expect(isTitleCase('7 Days')).toBe(true);
    expect(isTitleCase('Copy Channel ID')).toBe(true);
  });
});

describe('isMessage', () => {
  it('treats sentences and messages as sentences', () => {
    expect(isMessage('Delete this post?')).toBe(true);
    expect(isMessage('No channels yet')).toBe(true);
    expect(isMessage("Couldn't load the team")).toBe(true);
    expect(isMessage("Let's start")).toBe(false);
    expect(isMessage('Saving…')).toBe(true);
    expect(isMessage('Link the accounts you want to post to.')).toBe(true);
  });

  it('treats names as names', () => {
    expect(isMessage('Connect Channel')).toBe(false);
    expect(isMessage('Weekly Goal')).toBe(false);
  });
});

describe('offendersIn', () => {
  it('reads headings, buttons, ternaries and props', () => {
    const source = `
      export const A = () => (
        <div>
          <h2>First steps</h2>
          <Button>
            <Icon />
            Create post
          </Button>
          <Button>{saving ? 'Saving…' : 'Save changes'}</Button>
          <HomeSection title="Up next" />
          <EmptyState title="No posts yet" action={{ label: 'Create post' }} />
          <Button>Fine Already</Button>
        </div>
      );
    `;

    expect(offendersIn('x.tsx', source).map((offender) => offender.text)).toEqual([
      'First steps',
      'Create post',
      'Save changes',
      'Up next',
      'Create post',
    ]);
  });

  it('reads a name with a value in it as one string, each ternary branch on its own', () => {
    const source = `
      export const B = () => (
        <div>
          <DialogTitle>Cancel the {plan.name} plan?</DialogTitle>
          <DialogTitle>{down ? 'Switch to' : 'Upgrade To'} {plan.name}</DialogTitle>
          <Button>Customize for {channel.name}</Button>
          <Button>{collapsed ? null : <span>Add channel</span>}</Button>
          <Button>{\`Analyze (\${cost} \${cost === 1 ? 'Credit' : 'credits'})\`}</Button>
        </div>
      );
    `;

    // The question is a sentence; the rest are names with a value in them.
    expect(offendersIn('y.tsx', source).map((offender) => offender.text)).toEqual([
      'Switch to X',
      'Customize for X',
      'Add channel',
      'Analyze (X credits)',
    ]);
  });

  it("wants an icon button's aria-label to read like its tooltip", () => {
    const source = `
      export const D = () => (
        <div>
          <TooltipHint label="Insert Emoji"><button aria-label="Insert emoji" /></TooltipHint>
          <TooltipHint label="Copy Link"><button aria-label="Copy Link" /></TooltipHint>
        </div>
      );
    `;

    expect(offendersIn('z.tsx', source).map((offender) => offender.text)).toEqual(['Insert emoji']);
  });

  it('finds a state message button passed through a condition or a spread', () => {
    const source = `
      export const C = () => (
        <div>
          <ErrorState title="Oops." action={retry ? { label: 'Try again', onClick } : undefined} />
          <EmptyState title="No keys." {...(admin ? { action: { label: 'Create key', onClick } } : {})} />
          <EmptyState title="Fine." action={{ label: 'Add Webhook', onClick }} />
        </div>
      );
    `;

    expect(offendersIn('z.tsx', source).map((offender) => offender.text)).toEqual([
      'Try again',
      'Create key',
    ]);
  });
});

describe('the app', () => {
  it('writes every heading, title, button and tab in Title Case', () => {
    const offenders = SCAN.flatMap((directory) =>
      files(join(ROOT, directory)).flatMap((path) => {
        const name = relative(ROOT, path).replace(/\\/g, '/');
        if (SKIP_PATHS.some((skip) => name.startsWith(skip))) return [];
        return offendersIn(name, readFileSync(path, 'utf8'));
      }),
    );

    // Names are Title Case: fix the text, or allow it in ALLOWED with a reason.
    expect(offenders.map((offender) => `${offender.where} "${offender.text}"`)).toEqual([]);
  });
});
