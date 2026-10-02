import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Package,
  Search,
  ShoppingBag,
  Store
} from 'lucide-react';
import { getShopProduct, getShopProducts } from '../services/api';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';

const PAGE_SIZE = 24;

function validContact(value) {
  const normalized = String(value || '').replace(/[^\d+]/g, '');
  return /^\+?[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function formattedPrice(product, t) {
  if (product.price == null || !Number.isFinite(Number(product.price)) ||
      !product.priceUpdatedAt || !Number.isFinite(new Date(product.priceUpdatedAt).getTime())) {
    return t('shop.priceUnavailable');
  }
  const currency = /^[A-Z]{3}$/.test(product.currency || 'INR') ? product.currency || 'INR' : 'INR';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(Number(product.price));
}

function formattedPriceDate(value, t, language) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? t('shop.updated', { date: date.toLocaleDateString(language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) })
    : t('shop.priceDateUnavailable');
}

function ProductImage({ product, t }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) {
    return <div className="shop-product-image-placeholder">{t('shop.imageUnavailable')}</div>;
  }
  return <img src={product.imageUrl} alt={product.productName} onError={() => setFailed(true)} loading="lazy" />;
}

function SupplierContacts({ product, t }) {
  const phone = validContact(product.supplierPhone);
  const whatsapp = validContact(product.supplierWhatsApp);
  const preferredContact = String(product.contactMethod || '').toLowerCase();
  const primaryUrl = preferredContact === 'whatsapp' && whatsapp
    ? `https://wa.me/${whatsapp.replace('+', '')}`
    : phone
      ? `tel:${phone}`
      : whatsapp
        ? `https://wa.me/${whatsapp.replace('+', '')}`
        : null;

  return (
    <div className="shop-supplier-contact">
      {primaryUrl && (
        <a className="shop-contact-primary" href={primaryUrl} target={primaryUrl.startsWith('https:') ? '_blank' : undefined} rel={primaryUrl.startsWith('https:') ? 'noreferrer' : undefined}>
          {t('shop.contact')}
        </a>
      )}
      <div className="shop-contact-secondary">
        {phone && <a href={`tel:${phone}`}>{t('shop.call')}</a>}
        {phone && <a href={`sms:${phone}`}>{t('shop.message')}</a>}
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp.replace('+', '')}`} target="_blank" rel="noreferrer">{t('shop.whatsapp')}</a>
        )}
      </div>
      <p>{t('shop.orderNote')}</p>
    </div>
  );
}

function ProductDetails({ product, onBack, t, language }) {
  return (
    <article className="shop-product-detail">
      <button type="button" className="shop-back-button" onClick={onBack}>
        <ArrowLeft size={17} aria-hidden="true" /> {t('shop.back')}
      </button>
      <div className="shop-detail-grid">
        <div className="shop-product-detail-image"><ProductImage product={product} t={t} /></div>
        <div className="shop-product-detail-copy">
          <span className="shop-category-label">{product.category}</span>
          <h2>{product.productName}</h2>
          {product.brand && <p>{product.brand}</p>}
          <strong className="shop-detail-price">{formattedPrice(product, t)}</strong>
          <span className="shop-price-updated">{formattedPriceDate(product.priceUpdatedAt, t, language)}</span>
          <div className="shop-detail-metadata">
            {product.packSize && <span><Package size={16} aria-hidden="true" />{product.packSize}</span>}
            {product.supplierName && <span><Store size={16} aria-hidden="true" />{product.supplierName}</span>}
            {product.supplierLocation && (
              <span><MapPin size={16} aria-hidden="true" />{typeof product.supplierLocation === 'string' ? product.supplierLocation : [product.supplierLocation.city, product.supplierLocation.district, product.supplierLocation.state].filter(Boolean).join(', ')}</span>
            )}
            {product.availability && <span>{product.availability}</span>}
          </div>
          {product.crops?.length > 0 && <p><strong>{t('shop.suitableCrops')}</strong> {product.crops.join(', ')}</p>}
          {product.suitableStages?.length > 0 && <p><strong>{t('shop.suitableStages')}</strong> {product.suitableStages.join(', ')}</p>}
          {product.description && <p className="shop-product-description">{product.description}</p>}
          <SupplierContacts product={product} t={t} />
        </div>
      </div>
    </article>
  );
}

export default function ShopView({ profile = {}, initialFilters = {} }) {
  const { language } = useAppPreferences();
  const t = (key, values) => translate(language, key, values);
  const farm = profile.farm || {};
  const crop = initialFilters.crop || farm.cropDetails?.name || farm.crop || '';
  const variety = initialFilters.variety || farm.cropDetails?.variety || '';
  const [category, setCategory] = useState(initialFilters.category || '');
  const [searchText, setSearchText] = useState(initialFilters.query || '');
  const [filters, setFilters] = useState({
    category: initialFilters.category || '',
    crop,
    variety,
    stage: initialFilters.stage || '',
    query: initialFilters.query || '',
    page: 1,
    pageSize: PAGE_SIZE
  });
  const filtersKey = JSON.stringify(filters);
  const [productsRequest, setProductsRequest] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const currentProductsRequest = productsRequest?.key === filtersKey ? productsRequest : null;
  const result = currentProductsRequest?.result || { products: [], pagination: null };
  const loading = !currentProductsRequest || currentProductsRequest.loading;
  const error = currentProductsRequest?.error || '';
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getShopProducts(filters, { signal: controller.signal })
      .then((nextResult) => {
        setProductsRequest({ key: filtersKey, result: nextResult, loading: false, error: '' });
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setProductsRequest({
            key: filtersKey,
            result: { products: [], pagination: null },
            loading: false,
            error: requestError.message || 'Products are temporarily unavailable.'
          });
        }
      });
    return () => controller.abort();
  }, [filters, filtersKey, retryKey]);

  const openProduct = async (productId) => {
    setDetailLoading(true);
    setError('');
    try {
      setSelectedProduct(await getShopProduct(productId));
    } catch (requestError) {
      setError(requestError.message || 'Product details are temporarily unavailable.');
    } finally {
      setDetailLoading(false);
    }
  };

  const applySearch = (event) => {
    event.preventDefault();
    setSelectedProduct(null);
    setFilters((current) => ({ ...current, query: searchText.trim(), page: 1 }));
  };

  const retryProducts = () => {
    setProductsRequest((previous) => ({
      key: filtersKey,
      result: previous?.key === filtersKey ? previous.result : { products: [], pagination: null },
      loading: true,
      error: ''
    }));
    setRetryKey((previous) => previous + 1);
  };

  const selectCategory = (nextCategory) => {
    setCategory(nextCategory);
    setSelectedProduct(null);
    setFilters((current) => ({ ...current, category: nextCategory, page: 1 }));
  };

  const clearContext = () => {
    setCategory('');
    setSearchText('');
    setSelectedProduct(null);
    setFilters({ category: '', crop: '', variety: '', stage: '', query: '', page: 1, pageSize: PAGE_SIZE });
  };

  return (
    <div className="shop-view">
      <header className="shop-header">
        <span className="shop-header-icon"><ShoppingBag size={21} aria-hidden="true" /></span>
        <div>
          <h2>{t('shop.title')}</h2>
          <p>{crop ? `${t('shop.crop', { crop })}${initialFilters.stage ? ` · ${t('shop.stage', { stage: initialFilters.stage })}` : ''}` : t('shop.noCrop')}</p>
        </div>
      </header>

      {selectedProduct ? (
        <ProductDetails product={selectedProduct} onBack={() => setSelectedProduct(null)} t={t} language={language} />
      ) : (
        <>
          <form className="shop-search-form" onSubmit={applySearch}>
            <Search size={18} aria-hidden="true" />
            <input
              aria-label={t('shop.searchLabel')}
              placeholder={t('shop.searchPlaceholder')}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <button type="submit">{t('shop.search')}</button>
          </form>
          <div className="shop-category-filter" role="group" aria-label={t('shop.categoryFilter')}>
            {[['', 'shop.all'], ['seed', 'shop.seeds'], ['fertilizer', 'shop.fertilizers']].map(([value, labelKey]) => (
              <button
                key={value || 'all'}
                type="button"
                className={category === value ? 'selected' : ''}
                aria-pressed={category === value}
                onClick={() => selectCategory(value)}
              >
                {t(labelKey)}
              </button>
            ))}
            {(filters.crop || filters.stage || filters.query) && (
              <button type="button" className="shop-clear-context" onClick={clearContext}>{t('shop.clearFilters')}</button>
            )}
          </div>

          <div className="shop-results-heading">
            <h3>{filters.query || filters.category ? t('shop.matching') : t('shop.products')}</h3>
            {!loading && !error && <span>{t('shop.productCount', { count: result.pagination?.total || 0 })}</span>}
          </div>
          {error && <p className="shop-error" role="alert">{error}</p>}
          {loading ? (
            <div className="shop-loading" role="status">{t('shop.loading')}</div>
          ) : error ? (
            <button className="shop-retry" type="button" onClick={retryProducts}>{t('shop.retry')}</button>
          ) : result.products.length ? (
            <>
              <div className="shop-product-grid">
                {result.products.map((product) => (
                  <article className="shop-product-card" key={product.id}>
                    <div className="shop-product-card-image"><ProductImage product={product} t={t} /></div>
                    <div className="shop-product-card-body">
                      <span className="shop-category-label">{product.category}</span>
                      <h4>{product.productName}</h4>
                      {product.brand && <span className="shop-brand">{product.brand}</span>}
                      <strong className="shop-card-price">{formattedPrice(product, t)}</strong>
                      <span className="shop-price-updated">{formattedPriceDate(product.priceUpdatedAt, t, language)}</span>
                      {product.packSize && <span className="shop-product-meta"><Package size={14} aria-hidden="true" />{product.packSize}</span>}
                      {product.supplierName && <span className="shop-product-meta"><Store size={14} aria-hidden="true" />{product.supplierName}</span>}
                      {product.supplierLocation && (
                        <span className="shop-product-meta"><MapPin size={14} aria-hidden="true" />{typeof product.supplierLocation === 'string' ? product.supplierLocation : [product.supplierLocation.city, product.supplierLocation.district, product.supplierLocation.state].filter(Boolean).join(', ')}</span>
                      )}
                      {product.availability && <span className="shop-availability">{product.availability}</span>}
                      <button type="button" className="shop-view-product" disabled={detailLoading} onClick={() => void openProduct(product.id)}>
                        {detailLoading ? t('shop.loading') : t('shop.viewProduct')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <nav className="shop-pagination" aria-label="Product pages">
                <button
                  type="button"
                  disabled={filters.page <= 1}
                  onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
                >
                  <ChevronLeft size={17} aria-hidden="true" /> {t('shop.previous')}
                </button>
                <span>{t('shop.page', { page: filters.page })}</span>
                <button
                  type="button"
                  disabled={!result.pagination?.hasMore}
                  onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                >
                  {t('shop.next')} <ChevronRight size={17} aria-hidden="true" />
                </button>
              </nav>
            </>
          ) : (
            <div className="shop-empty-state">
              <ShoppingBag size={25} aria-hidden="true" />
              <h3>{t('shop.emptyTitle')}</h3>
              <p>{t('shop.emptyDescription')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
