import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { Badge, Button, DropdownMenuItem, MotionIcon, SplitButton } from '@postgear/ui';
import { Row, Section } from '../shared';

export function ButtonsSection() {
  return (
    <>
      <Section
        title="Buttons"
        description="One primary per area, secondary for everything else, red for deletes, violet for asking the AI. Every button stands on shadow-brutalSm, the same as the calendar tiles, and collapses to shadow-brutalPressed on click."
      >
        <Row label="Primary (one per area)">
          <Button size="sm">Create Post</Button>
          <Button size="md">Create Post</Button>
          <Button size="lg">Create Post</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row label="Split (one main action, the rest in its menu)">
          <SplitButton
            menuLabel="More actions"
            menu={
              <>
                <DropdownMenuItem>Run Now</DropdownMenuItem>
                <DropdownMenuItem>Versions</DropdownMenuItem>
              </>
            }
          >
            Activate
          </SplitButton>
          <SplitButton
            size="md"
            menuLabel="Choose the test data"
            menu={<DropdownMenuItem>Use The Built-In Sample</DropdownMenuItem>}
          >
            <MotionIcon icon={PlayIcon} className="h-4 w-4" />
            Test Workflow
          </SplitButton>
          <SplitButton
            disabled
            hint="Only workspace admins can do this."
            menuLabel="More actions"
            menu={<DropdownMenuItem>Run Now</DropdownMenuItem>}
          >
            Disabled
          </SplitButton>
        </Row>
        <Row label="Secondary (everything else)">
          <Button variant="secondary">Add Channel</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="Danger (deletes)">
          <Button variant="danger">Delete</Button>
          <Button variant="danger" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="Highlight (violet, the third button)">
          <Button variant="highlight">
            <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
            Ask AI
          </Button>
          <Button variant="highlight" disabled>
            Disabled
          </Button>
        </Row>
        <Row label="Ghost (icon only, on a surface that already has a border and shadow)">
          <div className="flex items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-surfaceSm">
            <Button variant="ghost" size="sm" className="w-9 px-0" aria-label="Test">
              <MotionIcon icon={PlayIcon} className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="w-9 px-0" aria-label="Test again" disabled>
              <MotionIcon icon={PlayIcon} className="h-4 w-4" />
            </Button>
          </div>
        </Row>
      </Section>

      <Section title="Badges" description="The sticker exception to the rounded-corner rule.">
        <Row label="Variants">
          <Badge variant="primary">Primary</Badge>
          <Badge variant="secondary">Live</Badge>
          <Badge variant="danger">Past due</Badge>
          <Badge variant="ai">AI Powered</Badge>
          <Badge variant="accent">New</Badge>
          <Badge variant="success">Published</Badge>
          <Badge variant="primary">Draft</Badge>
        </Row>
      </Section>
    </>
  );
}
