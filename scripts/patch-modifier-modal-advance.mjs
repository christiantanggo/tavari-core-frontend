import fs from 'fs';

const path = 'src/components/POS/ModifierSelectionModal.jsx';
let s = fs.readFileSync(path, 'utf8');

// In advanceAfterSelection, when nested groups unlock for the selected option, enter focus mode
const oldAdvance = `  const advanceAfterSelection = (groups, prevVisible, nextSelections, group, adding) => {
    const nextVisible = filterVisiblePosModifierGroups(groups, nextSelections, product?.id);
    if (!adding) return;

    const followUpRank = (g) => {
      const name = String(g?.name || '').toLowerCase();
      if (/\\bsize\\b/.test(name)) return 0;
      if (g?.is_required) return 1;
      if (/flavour|flavor/.test(name)) return 2;
      return 3;
    };

    const prevIds = new Set(prevVisible.map((g) => g.id));
    const newlyNeedingPick = nextVisible
      .filter(
        (g) => !prevIds.has(g.id) && !nextSelections.some((s) => s.group_id === g.id)
      )
      .sort((a, b) => followUpRank(a) - followUpRank(b));

    // Always Size before Flavour when both unlock together
    let unlockTargetId =
      newlyNeedingPick[0]?.id || pickNewlyUnlockedGroupId(prevVisible, nextVisible);

    // Nested follow-ups for the option just picked (even if somehow already listed)
    const selectedIds = new Set(
      nextSelections.filter((s) => s.group_id === group.id).map((s) => String(s.id))
    );
    const nestedForSelection = nextVisible
      .filter(
        (g) =>
          selectedIds.has(String(g.show_when_inventory_id || '')) &&
          !nextSelections.some((s) => s.group_id === g.id)
      )
      .sort((a, b) => followUpRank(a) - followUpRank(b));
    if (nestedForSelection.length > 0) {
      unlockTargetId = nestedForSelection[0].id;
    }`;

const newAdvance = `  const advanceAfterSelection = (groups, prevVisible, nextSelections, group, adding, pickedModifier = null) => {
    const nextVisible = filterVisiblePosModifierGroups(groups, nextSelections, product?.id);
    if (!adding) {
      if (pickedModifier?.id && String(nestedFocusParentId) === String(pickedModifier.id)) {
        setNestedFocusParentId(null);
      }
      return;
    }

    const followUpRank = (g) => {
      const name = String(g?.name || '').toLowerCase();
      if (/\\bsize\\b/.test(name)) return 0;
      if (g?.is_required) return 1;
      if (/flavour|flavor/.test(name)) return 2;
      return 3;
    };

    const pickedId = pickedModifier?.id ? String(pickedModifier.id) : null;
    const nestedForPicked = pickedId
      ? nextVisible
          .filter((g) => String(g.show_when_inventory_id || '') === pickedId)
          .sort((a, b) => followUpRank(a) - followUpRank(b))
      : [];

    // Enter Size→Flavour-only mode for this drink
    if (nestedForPicked.length > 0) {
      setNestedFocusParentId(pickedId);
    }

    const prevIds = new Set(prevVisible.map((g) => g.id));
    const newlyNeedingPick = nextVisible
      .filter(
        (g) => !prevIds.has(g.id) && !nextSelections.some((s) => s.group_id === g.id)
      )
      .sort((a, b) => followUpRank(a) - followUpRank(b));

    // Always Size before Flavour when both unlock together
    let unlockTargetId =
      newlyNeedingPick[0]?.id || pickNewlyUnlockedGroupId(prevVisible, nextVisible);

    if (nestedForPicked.length > 0) {
      const unfinished = nestedForPicked.find(
        (g) => !nextSelections.some((s) => s.group_id === g.id)
      );
      unlockTargetId = (unfinished || nestedForPicked[0]).id;
    }`;

if (!s.includes('const advanceAfterSelection = (groups, prevVisible, nextSelections, group, adding) => {')) {
  console.error('advanceAfterSelection signature not found');
  process.exit(1);
}

s = s.replace(oldAdvance, newAdvance);

// Update call site to pass modifier
s = s.replace(
  'advanceAfterSelection(groupsForToggle, prevVisible, nextSelections, group, adding);',
  'advanceAfterSelection(groupsForToggle, prevVisible, nextSelections, group, adding, modifier);'
);

if (!s.includes('advanceAfterSelection(groupsForToggle, prevVisible, nextSelections, group, adding, modifier);')) {
  console.error('call site not updated');
  process.exit(1);
}

fs.writeFileSync(path, s);
console.log('advanceAfterSelection patched');
