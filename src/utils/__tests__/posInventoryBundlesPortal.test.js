import { buildPortalInventoryById } from '../posInventoryBundles';

describe('buildPortalInventoryById', () => {
  it('merges bundle component items into the inventory lookup map', () => {
    const bundleId = 'bundle-1';
    const latexId = 'latex-1';
    const map = buildPortalInventoryById(
      [{ id: bundleId, name: 'Helium bouquet', is_bundle: true }],
      {
        componentItems: [
          { id: latexId, name: 'Latex Balloon', modifier_group_ids: ['grp-latex'] },
        ],
      },
    );

    expect(map.has(bundleId)).toBe(true);
    expect(map.get(latexId)?.modifier_group_ids).toEqual(['grp-latex']);
  });
});
