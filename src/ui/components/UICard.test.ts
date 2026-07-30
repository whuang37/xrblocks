import {describe, expect, it} from 'vitest';

import {UICard} from './UICard';

describe('UICard', () => {
  it('uses the shared manipulation configuration', () => {
    const card = new UICard({manipulation: true});

    expect(card.xb?.manipulation).toBe(true);
    expect(card.isUI).toBe(true);

    card.dispose();
  });
});
