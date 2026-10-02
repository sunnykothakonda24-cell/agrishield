const CATEGORIES = new Set(['seed', 'fertilizer']);

function normalizeCategory(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLocaleLowerCase().replace(/s$/, '');
  if (!CATEGORIES.has(normalized)) {
    const error = new Error('Shop category must be seed or fertilizer.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function text(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function productMatches(product, { category, crop, variety, stage, query }) {
  let actualCategory;
  try {
    actualCategory = normalizeCategory(product.category);
  } catch {
    return false;
  }
  if (!actualCategory) return false;
  if (category && actualCategory !== category) return false;

  const includesValue = (values, expected) => {
    if (!expected) return true;
    const list = Array.isArray(values) ? values : values == null ? [] : [values];
    return list.some((value) => text(value) === text(expected));
  };
  if (!includesValue(product.crops, crop)) return false;
  if (!includesValue(product.varieties, variety)) return false;
  if (!includesValue(product.suitableStages, stage)) return false;
  if (query) {
    const searchValues = [
      product.productName,
      product.name,
      product.brand,
      product.category,
      product.supplierName
    ];
    if (!searchValues.some((value) => text(value).includes(text(query)))) return false;
  }
  return true;
}

function filterProducts(products, filters = {}) {
  const category = normalizeCategory(filters.category);
  const search = {
    category,
    crop: typeof filters.crop === 'string' ? filters.crop.trim() : '',
    variety: typeof filters.variety === 'string' ? filters.variety.trim() : '',
    stage: typeof filters.stage === 'string' ? filters.stage.trim() : '',
    query: typeof filters.query === 'string' ? filters.query.trim() : ''
  };
  return products.filter((product) =>
    product.active === true && productMatches(product, search)
  );
}

module.exports = { filterProducts, normalizeCategory };
