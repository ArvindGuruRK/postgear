import { publishedLinks } from './published-links';

const channel = (channelId: string, releaseURL: string | null) => ({
  channelId,
  name: `Channel ${channelId}`,
  providerIdentifier: 'facebook',
  releaseURL,
});

describe('publishedLinks', () => {
  it('lists only the channels that went out, in the post order', () => {
    expect(
      publishedLinks([
        channel('a', 'https://www.facebook.com/1_2'),
        channel('b', null),
        channel('c', 'https://www.linkedin.com/feed/update/urn:li:share:3'),
      ]),
    ).toEqual([
      {
        channelId: 'a',
        name: 'Channel a',
        providerIdentifier: 'facebook',
        url: 'https://www.facebook.com/1_2',
      },
      {
        channelId: 'c',
        name: 'Channel c',
        providerIdentifier: 'facebook',
        url: 'https://www.linkedin.com/feed/update/urn:li:share:3',
      },
    ]);
  });

  it('is empty before anything is published', () => {
    expect(publishedLinks([channel('a', null)])).toEqual([]);
    expect(publishedLinks([])).toEqual([]);
  });

  it('drops an address that is not a web page, so a link can never run script', () => {
    expect(
      publishedLinks([
        channel('a', 'javascript:alert(1)'),
        channel('b', 'data:text/html,hi'),
        channel('c', 'not a url'),
        channel('d', ''),
        channel('e', 'http://localhost:3001/simulated/post/1'),
      ]).map((link) => link.channelId),
    ).toEqual(['e']);
  });
});
