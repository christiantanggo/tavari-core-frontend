// components/POS/POSProductGrid.jsx - Fixed modifier cart integration with smaller buttons
import React, { useState, useRef, useEffect } from "react";
import BarcodeScanHandler from "./BarcodeScanHandler";
import ModifierSelectionModal from "./ModifierSelectionModal";
import { TavariStyles } from "../../utils/TavariStyles";
import POSAuthWrapper from "../Auth/POSAuthWrapper";
import { usePOSAuth } from "../../hooks/usePOSAuth";
import { useTaxCalculations } from "../../hooks/useTaxCalculations";

const POSProductGrid = ({ products, onAddToCart, disabled = false }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 768);
  
  // Modifier selection modal state
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  
  const searchInputRef = useRef(null);

  // Authentication and business context
  const auth = usePOSAuth({
    requireBusiness: true,
    componentName: 'POSProductGrid'
  });

  // Tax calculations for price display
  const { calculateItemTax, formatTaxAmount, loading: taxLoading } = useTaxCalculations(auth.selectedBusinessId);

  // Track window width for responsive behavior
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate grid columns based on available space (excluding cart panel)
  const getGridColumns = () => {
    // Account for cart panel (380px) + padding and margins
    const availableWidth = windowWidth - 380 - 64 - 32; // cart width + padding + margin
    const buttonWidth = 140; // Smaller button width
    const gap = 16; // Grid gap
    
    if (availableWidth <= 0) return 2; // Fallback for very small screens
    
    const maxColumns = Math.floor((availableWidth + gap) / (buttonWidth + gap));
    return Math.max(2, Math.min(6, maxColumns)); // Limit to 6 columns max
  };

  // Handle product selection - check for modifiers first
  const handleProductClick = (product) => {
    // Check if product has modifier groups - More comprehensive check
    const hasModifierGroups = product.modifier_group_ids && 
      ((Array.isArray(product.modifier_group_ids) && product.modifier_group_ids.length > 0) ||
       (typeof product.modifier_group_ids === 'object' && product.modifier_group_ids !== null && Object.keys(product.modifier_group_ids).length > 0));
    
    if (hasModifierGroups) {
      // Show modifier selection modal
      setSelectedProduct(product);
      setShowModifierModal(true);
    } else {
      // Add directly to cart with proper structure
      const cartItem = {
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
        quantity: 1,
        modifiers: [] // Empty modifiers array for products without modifiers
      };
      onAddToCart(cartItem);
    }
  };

  // Handle modifier selection completion - FIXED VERSION
  const handleModifierAddToCart = (productWithModifiers) => {
    // Create properly structured cart item
    const cartItem = {
      id: productWithModifiers.id,
      name: productWithModifiers.name,
      price: productWithModifiers.price,
      category_id: productWithModifiers.category_id,
      station_ids: productWithModifiers.station_ids,
      track_stock: productWithModifiers.track_stock,
      stock_quantity: productWithModifiers.stock_quantity,
      barcode: productWithModifiers.barcode,
      sku: productWithModifiers.sku,
      image_url: productWithModifiers.image_url,
      modifier_group_ids: productWithModifiers.modifier_group_ids,
      quantity: 1,
      // Ensure modifiers array exists and is properly formatted
      modifiers: Array.isArray(productWithModifiers.modifiers) ? productWithModifiers.modifiers : []
    };
    
    // Add to cart
    onAddToCart(cartItem);
    
    // Close modal
    setShowModifierModal(false);
    setSelectedProduct(null);
  };

  // Handle modal close
  const handleModalClose = () => {
    setShowModifierModal(false);
    setSelectedProduct(null);
  };

  // Handle barcode scan from BarcodeScanHandler
  const handleBarcodeScan = (code) => {
    const match = products.find(
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
      const match = products.find(
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

  // Filter products by search term (categories handled by parent)
  const filteredProducts = products.filter((p) => {
    if (!searchTerm) return true;
    return (
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.barcode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

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
  const hasModifiers = (product) => {
    const result = product.modifier_group_ids && 
      ((Array.isArray(product.modifier_group_ids) && product.modifier_group_ids.length > 0) ||
       (typeof product.modifier_group_ids === 'object' && product.modifier_group_ids !== null && Object.keys(product.modifier_group_ids).length > 0));
    
    return result;
  };

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
      height: "100%",
      display: "flex",
      flexDirection: "column",
      backgroundColor: TavariStyles.colors.gray50,
      maxWidth: `calc(100vw - 420px)` // Ensure it never overlaps cart (380px + 40px margin)
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
      padding: `0 ${TavariStyles.spacing.lg}`,
      overflowY: "auto",
      width: "100%",
      maxWidth: "100%"
    },
    
    productGrid: {
      display: "grid",
      gridTemplateColumns: `repeat(${getGridColumns()}, 1fr)`,
      gap: TavariStyles.spacing.md,
      justifyItems: "stretch",
      paddingBottom: TavariStyles.spacing.xl,
      width: "100%",
      maxWidth: "100%"
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
      maxWidth: "140px", // Fixed smaller width
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
      fontSize: "10px"
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
      fontSize: "11px", // Smaller font
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
      fontSize: "12px", // Smaller price font
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    
    taxInclusivePrice: {
      fontSize: "9px", // Smaller tax price
      color: TavariStyles.colors.gray500,
      marginTop: "1px"
    },
    
    modifierHint: {
      fontSize: "9px", // Smaller modifier hint
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
      fontSize: "9px", // Smaller bottom text
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

  const ProductGridContent = () => (
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
            const isDisabled = isOutOfStock(product);
            const productHasModifiers = hasModifiers(product);
            
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
                {isOutOfStock(product) && (
                  <div style={{...styles.badge, ...styles.stockOutBadge}}>
                    OUT
                  </div>
                )}
                {isLowStock(product) && !isOutOfStock(product) && (
                  <div style={{...styles.badge, ...styles.stockLowBadge}}>
                    LOW
                  </div>
                )}

                {/* Modifier indicator */}
                {productHasModifiers && (
                  <div style={styles.modifierBadge}>
                    MOD
                  </div>
                )}

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
                  </div>
                  
                  {/* Bottom Row - Routing and Stock */}
                  <div style={styles.bottomRowContainer}>
                    <div style={styles.bottomRow}>
                      <span style={styles.stationInfo}>
                        {getStationBadge(product) || ""}
                      </span>
                      {product.track_stock && (
                        <span style={styles.stockInfo}>
                          {product.stock_quantity || 0}
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
    </div>
  );

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
      <ProductGridContent />
    </POSAuthWrapper>
  );
};

export default POSProductGrid;