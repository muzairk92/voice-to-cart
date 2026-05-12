// netlify/functions/voice-search.js
// Optimized Voice-to-Cart using Shopify Native Relevance Search

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || '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';

console.log('=== Voice-to-Cart Powered by Shopify Search ===');

// ============================================
// SHOPIFY GraphQL - NATIVE SEARCH QUERY
// ============================================
// Instead of fetching 250 products, we fetch the top 5 MOST RELEVANT items
const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($searchQuery: String!) {
    products(first: 5, query: $searchQuery) {
      edges {
        node {
          id
          title
          handle
          description
          priceRange {
            minVariantPrice {
              amount
            }
          }
          images(first: 1) {
            edges {
              node {
                url
              }
            }
          }
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    }
  }
`;

// ============================================
// MAKE ADMIN API REQUEST
// ============================================
async function shopifyRequest(query, variables = {}) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': AUTOMATION_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    const data = await response.json();

    if (data.errors) {
      console.error('❌ GraphQL Errors:', data.errors);
      throw new Error(data.errors[0].message);
    }
    return data.data;
  } catch (error) {
    console.error('❌ Shopify Request Error:', error.message);
    throw error;
  }
}

// ============================================
// CORS HEADERS
// ============================================
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ============================================
// NETLIFY FUNCTION HANDLER
// ============================================
exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { query, variantId, quantity = 1 } = body;

    // ============================================
    // VOICE SEARCH LOGIC
    // ============================================
    if (query) {
      console.log(`🎤 Voice Search: "${query}"`);

      // 1. Ask Shopify for the most relevant products based on the voice text
      const searchData = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { 
        searchQuery: query.trim() 
      });
      
      const products = searchData.products.edges.map(edge => edge.node);

      // 2. Handle No Results
      if (products.length === 0) {
        console.log(`❌ No matches found for: ${query}`);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            message: `No products found for "${query}"`,
          }),
        };
      }

      // 3. Shopify sorts by highest relevance automatically, so we grab the top result!
      const bestMatch = products[0];
      console.log(`✅ Best Match Found: ${bestMatch.title}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          product: {
            id: bestMatch.id,
            title: bestMatch.title,
            handle: bestMatch.handle,
            description: bestMatch.description,
            price: bestMatch.priceRange.minVariantPrice.amount,
            image: bestMatch.images.edges[0]?.node?.url || null,
            variantId: bestMatch.variants.edges[0]?.node?.id || null,
          },
        }),
      };
    }

    // ============================================
    // ADD TO CART LOGIC
    // ============================================
    if (variantId) {
      console.log(`🛒 Add to Cart: ${variantId}, Qty: ${quantity}`);
      const variantIdMatch = variantId.match(/\/(\d+)$/);
      const numericVariantId = variantIdMatch ? variantIdMatch[1] : variantId;
      
      const addToCartUrl = `https://${SHOPIFY_STORE}/cart/add?id=${numericVariantId}&quantity=${quantity}`;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          checkoutUrl: addToCartUrl,
          message: 'Added to cart!',
        }),
      };
    }

    // ============================================
    // DEFAULT FALLBACK
    // ============================================
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 'ok', store: SHOPIFY_STORE }),
    };

  } catch (error) {
    console.error('❌ Error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: error.message }),
    };
  }
};
