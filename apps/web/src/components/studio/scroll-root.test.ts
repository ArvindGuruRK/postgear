import { scrollRootOf } from './scroll-root';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scrollRootOf', () => {
  it('finds the nearest box that scrolls, on either axis', () => {
    document.body.innerHTML = `
      <main id="main" style="overflow-y: auto">
        <div style="overflow: hidden">
          <ol id="rail" style="overflow-y: scroll">
            <li><div id="thumbnail"></div></li>
          </ol>
          <ul id="strip" style="overflow-x: auto">
            <li><div id="kit"></div></li>
          </ul>
          <div id="card"><div id="cover"></div></div>
        </div>
      </main>
    `;
    const at = (id: string) => document.getElementById(id) as HTMLElement;

    expect(scrollRootOf(at('thumbnail'))).toBe(at('rail'));
    expect(scrollRootOf(at('kit'))).toBe(at('strip'));
    // A box that only clips (overflow hidden) is passed by.
    expect(scrollRootOf(at('cover'))).toBe(at('main'));
  });

  it('answers null for a slide on a page that scrolls in the viewport', () => {
    document.body.innerHTML = '<main><section><div id="slide"></div></section></main>';
    document.body.style.overflowY = 'auto';

    expect(scrollRootOf(document.getElementById('slide') as HTMLElement)).toBeNull();
    expect(scrollRootOf(document.body)).toBeNull();

    document.body.style.overflowY = '';
  });
});
