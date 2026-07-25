// components/POS/POSProductGrid.jsx - Fixed modifier cart integration with smaller buttons
import React, { useState, useRef, useEffect, useMemo } from "react";
import BarcodeScanHandler from "./BarcodeScanHandler";
import ModifierSelectionModal from "./ModifierSelectionModal";
import BundleModifierSelectionModal from "./BundleModifierSelectionModal";
import ProductFolderPickerModal from "./ProductFolderPickerModal";
import GiftCardSellModal from "./GiftCardSellModal";
import { TavariStyles } from "../../utils/TavariStyles";
import POSAuthWrapper from "../Auth/POSAuthWrapper";
import { usePOSAuth } from "../../hooks/usePOSAuth";
import { useTaxCalculations } from "../../hooks/useTaxCalculations";
import { normalizeModifierGroupIds } from "../../utils/posModifierGroupsLoader";
import { supabase } from "../../supabaseClient";
import toast from "react-hot-toast";

const POSProductGrid = ({ products, allProducts, onAddToCart, disabled = false }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 768);
  
  // Modifier selection modal state
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [showBundleModifierModal, setShowBundleModifierModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [giftCardProduct, setGiftCardProduct] = useState(null);
  const [folderChildren, setFolderChildren] = useState([]);
  
  const searchInputRef = useRef(null);
  const catalog = allProducts || products || [];

  // Authentication and business context
  const auth = usePOSAuth({
    requireBusiness: true,
    componentName: 'POSProductGrid'
  });

  // Tax calculations for price display
  const { calculateItemTax, formatTaxAmount, loading: taxLoading } = useTaxCalculations(auth.selectedBusinessId);

  // Track viewport width only for optional product images (not for grid column math —
  // grid uses CSS repeat(auto-fill, minmax(...)) so it fits the real container width).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getFolderChildren = (parentId) =>
    (catalog || []).filter(
      (p) => p.parent_inventory_id && String(p.parent_inventory_id) === String(parentId)
    );

  const buildCartItem = (product, extras = {}) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    category_id: product.category_id,
    station_ids: product.station_ids,
    track_stock: product.track_stock,
    stock_quantity: product.stock_quantity,
    barcode: product.barcode,
    sku: product.sku,
    image_url: product.image_url,
    modifier_group_ids: product.modifier_group_ids,
    is_bundle: product.is_bundle || false,
    quantity: 1,
    modifiers: [],
    bundle_component_modifiers: [],
    ...extras,
  });

  // Handle product selection - folders, gift cards, bundles, modifiers, or direct add
  const handleProductClick = async (product) => {
    const children = getFolderChildren(product.id);
    if (children.length > 0) {
      setSelectedProduct(product);
      setFolderChildren(
        [...children].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      );
      setShowFolderModal(true);
      return;
    }

    if (product.is_gift_card || product.gift_card_product_id) {
      setSelectedProduct(product);
      setGiftCardProduct(null);
      setShowGiftCardModal(true);
      try {
        let gc = null;
        if (product.gift_card_product_id) {
          const { data } = await supabase
            .from('gift_card_products')
            .select('*')
            .eq('id', product.gift_card_product_id)
            .maybeSingle();
          gc = data;
        }
        if (!gc) {
          const { data } = await supabase
            .from('gift_card_products')
            .select('*')
            .eq('business_id', auth.selectedBusinessId)
            .eq('pos_product_id', product.id)
            .maybeSingle();
          gc = data;
        }
        setGiftCardProduct(gc || {
          id: null,
          product_type: 'money',
          face_value: Number(product.price) || 0,
          sale_price: Number(product.price) || 0,
          name: product.name,
        });
      } catch (err) {
        toast.error(err.message || 'Unable to load gift card details');
        setShowGiftCardModal(false);
        setSelectedProduct(null);
      }
      return;
    }

    if (product.is_bundle) {
      setSelectedProduct(product);
      setShowBundleModifierModal(true);
      return;
    }

    if (hasModifiers(product)) {
      setSelectedProduct(product);
      setShowModifierModal(true);
    } else {
      onAddToCart(buildCartItem(product));
    }
  };

  const handleGiftCardConfirm = ({ price, gift_card }) => {
    if (!selectedProduct) return;
    onAddToCart(buildCartItem(selectedProduct, {
      price,
      is_gift_card: true,
      gift_card_product_id: gift_card?.gift_card_product_id || selectedProduct.gift_card_product_id || null,
      gift_card,
      tax_exempt: true,
      // Unique cart key so personal messages don't merge into one line
      cart_line_key: `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setShowGiftCardModal(false);
    setSelectedProduct(null);
    setGiftCardProduct(null);
  };

  const handleFolderChildSelect = (child) => {
    const folder = selectedProduct;
    setShowFolderModal(false);
    setFolderChildren([]);
    setSelectedProduct(null);
    // Folder base price (e.g. Bubly $1.77); flavour children can be $0.
    const folderPrice = Number(folder?.price);
    const pricedChild =
      folderPrice > 0
        ? { ...child, price: folderPrice }
        : child;
    handleProductClick(pricedChild);
  };

  const handleModifierAddToCart = (productWithModifiers) => {
    onAddToCart(buildCartItem(productWithModifiers, {
      modifiers: Array.isArray(productWithModifiers.modifiers) ? productWithModifiers.modifiers : [],
    }));
    setShowModifierModal(false);
    setSelectedProduct(null);
  };

  const handleBundleModifierAddToCart = (productWithBundleModifiers) => {
    onAddToCart(buildCartItem(productWithBundleModifiers, {
      is_bundle: true,
      modifiers: Array.isArray(productWithBundleModifiers.modifiers)
        ? productWithBundleModifiers.modifiers
        : [],
      bundle_component_modifiers: productWithBundleModifiers.bundle_component_modifiers || [],
    }));
    setShowBundleModifierModal(false);
    setSelectedProduct(null);
  };

  const handleModalClose = () => {
    setShowModifierModal(false);
    setShowBundleModifierModal(false);
    setShowFolderModal(false);
    setShowGiftCardModal(false);
    setGiftCardProduct(null);
    setFolderChildren([]);
    setSelectedProduct(null);
  };

  // Handle barcode scan from BarcodeScanHandler
  const handleBarcodeScan = (code) => {
    const match = catalog.find(
      (p) =>
        p.barcode?.toLowerCase() === code.toLowerCase() ||
        p.sku?.toLowerCase() === code.toLowerCase()
    );
    if (match) {
      handleProductClick(match);
    } else {
      console.log("Product not found for barcode:", code);
    }
  };

  // Handle search input changes
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  // Handle enter key for search/barcode entry
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && searchTerm.trim() !== "") {
      const match = catalog.find(
        (p) =>
          p.barcode?.toLowerCase() === searchTerm.trim().toLowerCase() ||
          p.name.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
          p.sku?.toLowerCase() === searchTerm.trim().toLowerCase()
      );
      if (match) {
        handleProductClick(match);
        setSearchTerm("");
      } else {
        console.log("Product not found for:", searchTerm);
      }
    }
  };

  // Root tiles only when not searching; search includes nested folder children
  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const pool = products || [];
    if (!term) {
      return pool.filter((p) => !p.parent_inventory_id);
    }
    // Prefer catalog so children outside the active category filter still match
    const searchPool = catalog.length ? catalog : pool;
    return searchPool.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term)
    );
  }, [products, catalog, searchTerm]);

  // Check if product is out of stock
  const isOutOfStock = (product) => {
    return product.track_stock && (product.stock_quantity || 0) <= 0;
  };

  // Check if product is low stock
  const isLowStock = (product) => {
    return product.track_stock && 
           (product.stock_quantity || 0) > 0 && 
           (product.stock_quantity || 0) <= (product.low_stock_threshold || 5);
  };

  // Check if product has modifiers
  const hasModifiers = (product) =>
    normalizeModifierGroupIds(product?.modifier_group_ids).length > 0;

  // Get station routing display - now supports multiple stations
  const getStationBadge = (product) => {
    if (!product.station_ids) return null;
    
    // Handle both array and JSON string formats
    let stations = [];
    if (Array.isArray(product.station_ids)) {
      stations = product.station_ids;
    } else if (typeof product.station_ids === 'string') {
      try {
        stations = JSON.parse(product.station_ids);
      } catch (e) {
        return null;
      }
    }
    
    return stations.length > 0 ? stations.join(" + ") : null;
  };

  // Calculate display price including tax information
  const getDisplayPrice = (product) => {
    const basePrice = Number(product.price || 0);
    
    if (taxLoading) {
      return {
        displayPrice: basePrice,
        taxInfo: null
      };
    }

    try {
      const taxInfo = calculateItemTax(product, basePrice);
      const priceWithTax = basePrice + taxInfo.taxAmount;
      
      return {
        displayPrice: basePrice,
        priceWithTax,
        taxInfo,
        showTaxInclusive: taxInfo.taxAmount > 0
      };
    } catch (err) {
      console.warn('Error calculating tax for product:', product.id, err);
      return {
        displayPrice: basePrice,
        taxInfo: null
      };
    }
  };

  // Create styles using TavariStyles - UPDATED WITH SMALLER BUTTONS
  const styles = {
    container: {
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      backgroundColor: TavariStyles.colors.gray50,
      boxSizing: "border-box"
    },
    
    searchContainer: {
      marginBottom: TavariStyles.spacing.lg,
      padding: `0 ${TavariStyles.spacing.lg}`,
      flexShrink: 0
    },
    
    searchInput: {
      ...TavariStyles.components.form.input,
      width: "100%",
      border: `2px solid ${TavariStyles.colors.primary}`,
      borderRadius: TavariStyles.borderRadius.lg,
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: "border-box",
      transition: TavariStyles.transitions.normal
    },
    
    gridContainer: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      padding: `0 ${TavariStyles.spacing.lg}`,
      overflowY: "auto",
      overflowX: "hidden",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box"
    },
    
    productGrid: {
      display: "grid",
      // Fits whatever width the parent flex column actually has (not 100vw — avoids overlap with cart)
      gridTemplateColumns: "repeat(auto-fill, minmax(min(124px, 100%), 1fr))",
      gap: TavariStyles.spacing.md,
      justifyItems: "stretch",
      paddingBottom: TavariStyles.spacing.xl,
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box"
    },
    
    productButton: {
      ...TavariStyles.components.button.base,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      border: `2px solid ${TavariStyles.colors.primary}`,
      borderRadius: TavariStyles.borderRadius.md,
      overflow: "hidden",
      backgroundColor: TavariStyles.colors.white,
      position: "relative",
      width: "100%",
      height: "120px", // Fixed smaller height
      maxWidth: "min(140px, 100%)",
      transition: `all ${TavariStyles.transitions.normal}`,
      padding: 0,
      boxShadow: TavariStyles.shadows.sm,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.xs,
      margin: "0 auto" // Center buttons in grid
    },
    
    badge: {
      position: "absolute",
      color: TavariStyles.colors.white,
      fontSize: "10px", // Smaller badge text
      padding: `2px 4px`, // Smaller badge padding
      borderRadius: TavariStyles.borderRadius.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      zIndex: 10,
      top: "2px",
      left: "2px"
    },
    
    stockOutBadge: {
      backgroundColor: TavariStyles.colors.danger
    },
    
    stockLowBadge: {
      backgroundColor: TavariStyles.colors.warning
    },
    
    modifierBadge: {
      position: "absolute",
      top: "2px",
      right: "2px",
      backgroundColor: TavariStyles.colors.secondary,
      color: TavariStyles.colors.white,
      fontSize: "9px", // Smaller modifier badge
      padding: `1px 3px`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'flex',
      alignItems: 'center',
      gap: "1px"
    },

    folderBadge: {
      position: "absolute",
      top: "2px",
      right: "2px",
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      fontSize: "10px",
      padding: `1px 3px`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },

    folderHint: {
      fontSize: "11px",
      color: TavariStyles.colors.primary,
      marginTop: "1px",
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    imageContainer: {
      width: "100%",
      height: "50px", // Smaller image height
      position: "relative",
      flexShrink: 0
    },
    
    productImage: {
      objectFit: "cover",
      width: "100%",
      height: "100%"
    },
    
    placeholderImage: {
      width: "100%",
      height: "100%",
      backgroundColor: TavariStyles.colors.gray100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: TavariStyles.colors.gray400,
      fontSize: "12px"
    },
    
    productInfo: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      width: "100%",
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      boxSizing: "border-box",
      padding: "4px", // Smaller padding
      flex: 1,
      justifyContent: "space-between"
    },
    
    nameContainer: {
      width: "100%",
      minHeight: "24px", // Smaller name container
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: "2px"
    },
    
    productName: {
      fontSize: "9px", // Smaller font
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      width: "100%",
      textAlign: "center",
      color: TavariStyles.colors.gray800,
      lineHeight: "1.2",
      display: "-webkit-box",
      WebkitLineClamp: "2",
      WebkitBoxOrient: "vertical",
      overflow: "hidden"
    },
    
    priceContainer: {
      width: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      marginBottom: "2px"
    },
    
    productPrice: {
      fontSize: "9px", // Smaller price font
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    
    taxInclusivePrice: {
      fontSize: "9px", // Smaller tax price
      color: TavariStyles.colors.gray500,
      marginTop: "1px"
    },
    
    modifierHint: {
      fontSize: "7px", // Smaller modifier hint
      color: TavariStyles.colors.secondary,
      marginTop: "1px",
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    bottomRowContainer: {
      width: "100%",
      minHeight: "14px", // Smaller bottom row
      display: "flex",
      alignItems: "center"
    },
    
    bottomRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      width: "100%",
      fontSize: "7px", // Smaller bottom text
      padding: `0 2px`
    },
    
    stationInfo: {
      color: TavariStyles.colors.gray500,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      textAlign: "left",
      maxWidth: "65%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    },
    
    stockInfo: {
      color: TavariStyles.colors.gray500,
      textAlign: "right",
      flexShrink: 0,
      fontWeight: TavariStyles.typography.fontWeight.normal
    },
    
    noProducts: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: `${TavariStyles.spacing['4xl']} 0`,
      color: TavariStyles.colors.gray400,
      fontSize: TavariStyles.typography.fontSize.lg,
      textAlign: "center"
    }
  };

  // Do not define an inner component here — a new type each render remounts the
  // modifier modal and clears selections (register clock / inventory refresh).
  return (
    <POSAuthWrapper
      requireBusiness={true}
      componentName="POSProductGrid"
      onAuthReady={(authData) => {
        console.log('POSProductGrid: Authentication ready', {
          businessId: authData.selectedBusinessId,
          userRole: authData.userRole
        });
      }}
    >
      <div style={styles.container}>
      {/* Barcode Scanner Handler */}
      <BarcodeScanHandler onScan={handleBarcodeScan} />
      
      {/* Search bar */}
      <div style={styles.searchContainer}>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search, Scan Barcode, or Enter SKU..."
          style={styles.searchInput}
          value={searchTerm}
          onChange={handleSearchChange}
          onKeyDown={handleKeyDown}
		  autoComplete="off"
          autoFocus={!disabled}
          disabled={disabled}
          tabIndex={disabled ? -1 : 0}
        />
      </div>

      {/* Product grid */}
      <div style={styles.gridContainer}>
        <div style={styles.productGrid}>
          {filteredProducts.map((product) => {
            const priceInfo = getDisplayPrice(product);
            const productHasFolder = getFolderChildren(product.id).length > 0;
            const isDisabled = productHasFolder ? false : isOutOfStock(product);
            const productHasModifiers = !productHasFolder && hasModifiers(product);
            
            return (
              <button
                key={product.id}
                onClick={() => {
                  console.log('Button clicked for:', product.name);
                  handleProductClick(product);
                }}
                disabled={isDisabled}
                style={{
                  ...styles.productButton,
                  ...(isDisabled ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                  ...(productHasModifiers ? { 
                    borderColor: TavariStyles.colors.secondary,
                    boxShadow: `0 0 0 1px ${TavariStyles.colors.secondary}20`
                  } : {}),
                  ...(productHasFolder ? {
                    borderColor: TavariStyles.colors.primary,
                    boxShadow: `0 0 0 1px ${TavariStyles.colors.primary}20`
                  } : {})
                }}
                onMouseEnter={(e) => {
                  if (!isDisabled) {
                    e.target.style.boxShadow = TavariStyles.shadows.md;
                    e.target.style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.boxShadow = TavariStyles.shadows.sm;
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                {/* Stock status indicators */}
                {isOutOfStock(product) && !productHasFolder && (
                  <div style={{...styles.badge, ...styles.stockOutBadge}}>
                    OUT
                  </div>
                )}
                {isLowStock(product) && !isOutOfStock(product) && !productHasFolder && (
                  <div style={{...styles.badge, ...styles.stockLowBadge}}>
                    LOW
                  </div>
                )}

                {/* Folder / modifier indicators */}
                {productHasFolder ? (
                  <div style={styles.folderBadge}>
                    FOLDER
                  </div>
                ) : productHasModifiers ? (
                  <div style={styles.modifierBadge}>
                    MOD
                  </div>
                ) : null}

                {/* Product Image - Only show on medium+ screens and make smaller */}
                {windowWidth >= 800 && (
                  <div style={styles.imageContainer}>
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        style={styles.productImage}
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    
                    <div 
                      style={{
                        ...styles.placeholderImage,
                        display: product.image_url ? 'none' : 'flex'
                      }}
                    >
                      No Image
                    </div>
                  </div>
                )}

                {/* Product Info */}
                <div style={styles.productInfo}>
                  {/* Product Name */}
                  <div style={styles.nameContainer}>
                    <span style={styles.productName}>
                      {product.name}
                    </span>
                  </div>
                  
                  {/* Price */}
                  <div style={styles.priceContainer}>
                    {productHasFolder ? (
                      <span style={styles.folderHint}>
                        Choose option ›
                      </span>
                    ) : (
                      <>
                        <span style={styles.productPrice}>
                          ${priceInfo.displayPrice.toFixed(2)}
                        </span>
                        {priceInfo.showTaxInclusive && (
                          <span style={styles.taxInclusivePrice}>
                            ${priceInfo.priceWithTax.toFixed(2)} incl. tax
                          </span>
                        )}
                        {productHasModifiers && (
                          <span style={styles.modifierHint}>
                            Customizable
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  
                  {/* Bottom Row - Routing and Stock */}
                  <div style={styles.bottomRowContainer}>
                    <div style={styles.bottomRow}>
                      <span style={styles.stationInfo}>
                        {getStationBadge(product) || ""}
                      </span>
                      {product.track_stock && !productHasFolder && (
                        <span style={styles.stockInfo}>
                          {product.stock_quantity || 0}
                        </span>
                      )}
                      {productHasFolder && (
                        <span style={styles.stockInfo}>
                          {getFolderChildren(product.id).length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* No products found */}
      {filteredProducts.length === 0 && (
        <div style={styles.noProducts}>
          {searchTerm ? "No products found matching your search" : "No products available"}
        </div>
      )}

      {/* Modifier Selection Modal */}
      <ModifierSelectionModal
        isOpen={showModifierModal}
        onClose={handleModalClose}
        product={selectedProduct}
        businessId={auth.selectedBusinessId}
        onAddToCart={handleModifierAddToCart}
      />
      <BundleModifierSelectionModal
        isOpen={showBundleModifierModal}
        onClose={handleModalClose}
        product={selectedProduct}
        businessId={auth.selectedBusinessId}
        onAddToCart={handleBundleModifierAddToCart}
      />
      <ProductFolderPickerModal
        isOpen={showFolderModal}
        onClose={handleModalClose}
        folderProduct={selectedProduct}
        childrenProducts={folderChildren}
        onSelectChild={handleFolderChildSelect}
      />
      {showGiftCardModal && selectedProduct && (
        <GiftCardSellModal
          product={selectedProduct}
          giftCardProduct={giftCardProduct}
          businessId={auth.selectedBusinessId}
          onConfirm={handleGiftCardConfirm}
          onClose={() => {
            setShowGiftCardModal(false);
            setSelectedProduct(null);
            setGiftCardProduct(null);
          }}
        />
      )}
    </div>
      </POSAuthWrapper>
  );
};

export default POSProductGrid;