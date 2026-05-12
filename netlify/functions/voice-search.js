// netlify/functions/voice-search.js
// Variant-Aware Smart Routing

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
          variants(first: 20) {
            edges {
              node {
                id
                title
              }
            }
          }
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
  const data = await response.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const query = body.query || '';

    if (query) {
      console.log(`🎤 Voice Search: "${query}"`);

      const searchData = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { searchQuery: query.trim() });
      const products = searchData.products.edges.map(edge => edge.node);

      if (products.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "No products found." }) };
      }

      const bestMatch = products[0];
      const variants = bestMatch.variants.edges.map(v => v.node);
      
      let targetUrl = '';
      let variantMatchFound = false;
      let selectedVariantId = variants[0].id; // Default to first variant

      // 1. Check if the user specifically spoke a variant color/size (e.g., "Red")
      if (variants.length > 1) {
        const queryLower = query.toLowerCase();
        const matchedVariant = variants.find(v => {
          const vTitle = v.title.toLowerCase();
          return vTitle !== 'default title' && queryLower.includes(vTitle);
        });
        
        if (matchedVariant) {
          selectedVariantId = matchedVariant.id;
          variantMatchFound = true;
          console.log(`🎨 Exact Variant Requested: ${matchedVariant.title}`);
        }
      }

      // 2. DECISION ENGINE (Where do we send the user?)
      if (products.length > 1 && !variantMatchFound) {
        // SCENARIO 1: Multiple caps exist, user didn't specify color -> Send to Search Results
        console.log('🔄 Multiple products found. Routing to Search Page.');
        targetUrl = `https://${SHOPIFY_STORE}/search?q=${encodeURIComponent(query)}`;
      } 
      else if (variants.length > 1 && !variantMatchFound) {
        // SCENARIO 2: One cap found, but it has colors, user didn't specify -> Send to Product Page
        console.log('🔄 Product has options. Routing to Product Page.');
        targetUrl = `https://${SHOPIFY_STORE}/products/${bestMatch.handle}`;
      } 
      else {
        // SCENARIO 3: Perfect match (no variants OR user asked for a specific color) -> Add to Cart!
        console.log('🛒 Perfect match. Adding to Cart.');
        const numericVariantId = selectedVariantId.match(/\/(\d+)$/)[1];
        targetUrl = `https://${SHOPIFY_STORE}/cart/add?id=${numericVariantId}&quantity=1`;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          checkoutUrl: targetUrl // Your frontend will automatically navigate here
        }),
      };
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
