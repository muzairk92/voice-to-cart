// netlify/functions/voice-search.js
// Fixed: Uses Admin API for search, Storefront API for cart

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID ;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET ;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN ;

console.log('=== Voice-to-Cart Initialized ===');
console.log('Store:', SHOPIFY_STORE);

// ============================================
// SHOPIFY GraphQL QUERIES
// ============================================
const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($query: String!) {
    products(first: 10, query: $query) {
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
// MAKE ADMIN API REQUEST (for search)
// ============================================
async function shopifyRequest(query, variables = {}) {
  console.log('📤 Making Shopify Admin API request...');
  
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

    console.log('✅ API request successful');
    return data.data;
  } catch (error) {
    console.error('❌ Shopify Request Error:', error.message);
    throw error;
  }
}

// ============================================
// FIND BEST MATCH
// ============================================
function findBestMatch(searchQuery, products) {
  if (!products || products.length === 0) return null;

  const normalizedQuery = searchQuery.toLowerCase().trim();
  const queryWords = normalizedQuery.split(' ');

  const scoredProducts = products.map((product) => {
    const title = product.title.toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    let score = 0;
    queryWords.forEach((word) => {
      if (combined.includes(word)) score += 1;
    });

    if (title.includes(normalizedQuery)) score += 5;

    return { product, score };
  });

  scoredProducts.sort((a, b) => b.score - a.score);
  return scoredProducts[0]?.score > 0 ? scoredProducts[0].product : null;
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
  console.log('\n=== Voice-to-Cart Function Called ===');
  console.log('Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { query, variantId, quantity = 1 } = body;

    // ============================================
    // VOICE SEARCH - Search products via Admin API
    // ============================================
    if (query) {
      console.log(`🎤 Voice Search: "${query}"`);

      if (!query.trim()) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            message: 'Search query is required',
          }),
        };
      }

      try {
        const data = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { query });
        const products = data.products.edges.map((edge) => edge.node);

        console.log(`Found ${products.length} products`);

        if (products.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              success: false,
              message: `No products found for "${query}"`,
            }),
          };
        }

        const bestMatch = findBestMatch(query, products);

        if (!bestMatch) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              success: false,
              message: `No suitable match for "${query}"`,
            }),
          };
        }

        console.log(`✅ Found: ${bestMatch.title}`);

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
      } catch (error) {
        console.error('Search error:', error.message);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            message: `Search failed: ${error.message}`,
          }),
        };
      }
    }

    // ============================================
    // ADD TO CART - Return checkout URL for client to handle
    // ============================================
    if (variantId) {
      console.log(`🛒 Add to Cart: ${variantId}`);

      try {
        // Extract the variant ID number from the GraphQL ID
        // "gid://shopify/ProductVariant/51329691156775" -> "51329691156775"
        const variantIdMatch = variantId.match(/\/(\d+)$/);
        if (!variantIdMatch) {
          throw new Error('Invalid variant ID format');
        }

        const numericVariantId = variantIdMatch[1];
        console.log('Numeric Variant ID:', numericVariantId);

        // Return the checkout URL - the frontend will redirect to it
        const checkoutUrl = `https://${SHOPIFY_STORE}/cart/${numericVariantId}:${quantity}`;

        console.log(`✅ Checkout URL generated: ${checkoutUrl}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            checkoutUrl: checkoutUrl,
            message: 'Redirecting to cart...',
          }),
        };
      } catch (error) {
        console.error('Cart error:', error.message);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            message: `Add to cart failed: ${error.message}`,
          }),
        };
      }
    }

    // ============================================
    // HEALTH CHECK
    // ============================================
    console.log('Health check');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        message: 'Voice-to-Cart API is running',
        store: SHOPIFY_STORE,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: error.message,
      }),
    };
  }
};
