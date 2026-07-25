// src/components/VendingMachine/ProductGrid.jsx
// Product grid display for vending machine

import { getProductPriceDisplay } from '../../utils/vendingTaxHelpers';
import './ProductGrid.css';

const ProductGrid = ({
  products,
  onSelect,
  initialLoading,
  loadError,
  onRetry,
  taxCalc
}) => {
  if (initialLoading && (!products || products.length === 0)) {
    return (
      <div className="product-grid-loading">
        <div className="spinner"></div>
        <p>Loading products...</p>
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="product-grid-empty">
        {loadError ? (
          <>
            <h2>Could not load products</h2>
            <p>{loadError}</p>
            <p>Ask staff to unlock the menu (top right) and tap Refresh.</p>
            {onRetry ? (
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                Try again
              </button>
            ) : null}
          </>
        ) : (
          <>
            <h2>No products on this device yet</h2>
            <p>
              Program slots in <strong>Tavari Dashboard → Tavari Vending → Slots &amp; stock</strong>.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="product-grid-wrap">
      <div className="product-grid">
        {products.map((product, index) => {
          const stockNum =
            product.num != null ? Number(product.num) : product.stock != null ? Number(product.stock) : 0;
          const isAvailable = stockNum > 0;
          const priceInfo = getProductPriceDisplay(product, taxCalc);

          return (
            <div
              key={product.goodsId ? `${product.goodsId}-${index}` : `slot-${index}`}
              className={`product-card ${!isAvailable ? 'out-of-stock' : ''}`}
              onClick={() => isAvailable && onSelect(product)}
            >
              <div className="product-image">
                {product.picUrl ? (
                  <img
                    src={product.picUrl}
                    alt={product.goodsName || 'Product'}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="product-image-placeholder">
                    <span>📦</span>
                  </div>
                )}
                {!isAvailable ? (
                  <div className="product-out-of-stock-badge">Out</div>
                ) : null}
              </div>

              <div className="product-info">
                <h3 className="product-name">{product.goodsName || 'Product'}</h3>
                <div className="product-price-block">
                  <div className="product-price">${priceInfo.basePrice.toFixed(2)}</div>
                  {priceInfo.showTaxInclusive ? (
                    <div className="product-price-tax">${priceInfo.priceWithTax.toFixed(2)} incl.</div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProductGrid;
