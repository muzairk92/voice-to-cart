// netlify/functions/voice-search.js
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || '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';

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($searchQuery: String!) {
    products(first: 5, query: $searchQuery) {
      edges {
        node {
          id
          title
          handle
          priceRange { minVariantPrice { amount } }
          images(first: 1) { edges { node { url } } }
          variants(first: 20) { edges { node { id title } } }
        }
      }
    }
  }
`;

async function shopifyRequest(query, variables = {}) {
  const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': AUTOMATION_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()).data;
}

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  try {
    const { query } = JSON.parse(event.body || '{}');

    if (query) {
      console.log(`🎤 Voice Search: "${query}"`);
      const searchData = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { searchQuery: query.trim() });
      const products = searchData.products.edges.map(e => e.node);

      if (products.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "No products found." }) };
      }

      const bestMatch = products[0];
      const variants = bestMatch.variants.edges.map(v => v.node);
      
      let variantMatchFound = false;
      let selectedVariantId = variants[0].id;

      // Check if user spoke a specific variant color/size
      if (variants.length > 1) {
        const queryLower = query.toLowerCase();
        const matchedVariant = variants.find(v => v.title.toLowerCase() !== 'default title' && queryLower.includes(v.title.toLowerCase()));
        if (matchedVariant) {
          selectedVariantId = matchedVariant.id;
          variantMatchFound = true;
        }
      }

      // DECISION ENGINE
      if (products.length > 1 && !variantMatchFound) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'redirect', url: `https://${SHOPIFY_STORE}/search?q=${encodeURIComponent(query)}` }) };
      } 
      else if (variants.length > 1 && !variantMatchFound) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'redirect', url: `https://${SHOPIFY_STORE}/products/${bestMatch.handle}` }) };
      } 
      else {
        // Perfect match: Send all data needed for the frontend modal!
        return {
          statusCode: 200, headers, body: JSON.stringify({
            success: true,
            action: 'modal',
            product: {
              title: variantMatchFound ? `${bestMatch.title} - ${variants.find(v=>v.id===selectedVariantId).title}` : bestMatch.title,
              image: bestMatch.images?.edges[0]?.node?.url || null,
              price: bestMatch.priceRange.minVariantPrice.amount,
              variantId: selectedVariantId.match(/\/(\d+)$/)[1] // Clean numeric ID for Shopify Cart API
            }
          })
        };
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
