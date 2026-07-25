import fs from 'fs';

const path = 'src/components/POS/ModifierSelectionModal.jsx';
let s = fs.readFileSync(path, 'utf8');
const start = s.indexOf('  const [modifierGroups, setModifierGroups] = useState([]);');
const end = s.indexOf('  const loadModifierGroups = async () => {');
if (start < 0 || end < 0) {
  console.error('markers not found', start, end);
  process.exit(1);
}

const replacement = `  const [modifierGroups, setModifierGroups] = useState([]);
  const [selectedModifiers, setSelectedModifiers] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [skipVisibleGroupSync, setSkipVisibleGroupSync] = useState(false);
  /** Drink option id — while set, only Size/Flavour for that drink are shown. */
  const [nestedFocusParentId, setNestedFocusParentId] = useState(null);

  useEffect(() => {
    if (isOpen && product?.id && product?.modifier_group_ids && businessId) {
      loadModifierGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: product.id, not product
  }, [isOpen, product?.id, businessId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedModifiers([]);
      setModifierGroups([]);
      setActiveGroupId(null);
      setError(null);
      setSkipVisibleGroupSync(false);
      setNestedFocusParentId(null);
    }
  }, [isOpen]);

  const followUpRank = (group) => {
    const name = String(group?.name || '').toLowerCase();
    if (/\\bsize\\b/.test(name)) return 0;
    if (group?.is_required) return 1;
    if (/flavour|flavor/.test(name)) return 2;
    return 3;
  };

  const visibleGroups = useMemo(() => {
    const all = sortModifierGroupsForDisplay(
      filterVisiblePosModifierGroups(modifierGroups, selectedModifiers, product?.id),
      product?.modifier_group_ids
    );
    if (!nestedFocusParentId) return all;
    const nested = all
      .filter(
        (g) => String(g.show_when_inventory_id || '') === String(nestedFocusParentId)
      )
      .sort((a, b) => followUpRank(a) - followUpRank(b));
    return nested.length > 0 ? nested : all;
  }, [
    modifierGroups,
    selectedModifiers,
    product?.id,
    product?.modifier_group_ids,
    nestedFocusParentId,
  ]);

  useEffect(() => {
    if (skipVisibleGroupSync) {
      setSkipVisibleGroupSync(false);
      return;
    }
    if (visibleGroups.length === 0) {
      setActiveGroupId(null);
      return;
    }

    // Hard rule: unfinished Size always wins over Flavour
    const unfinishedSize = visibleGroups.find(
      (g) =>
        /\\bsize\\b/i.test(String(g.name || '')) &&
        !selectedModifiers.some((s) => s.group_id === g.id)
    );
    if (unfinishedSize) {
      setActiveGroupId(unfinishedSize.id);
      return;
    }

    setActiveGroupId((prev) => {
      if (prev && visibleGroups.some((group) => group.id === prev)) {
        return prev;
      }
      return visibleGroups[0].id;
    });
  }, [visibleGroups, skipVisibleGroupSync, selectedModifiers]);

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(path, s);
console.log('ok');
