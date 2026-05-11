// netlify/functions/voice-search.js
// Simplified version without axios dependency

// ============================================
// CONFIGURATION
// ============================================
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '9b14c6a09e2bd6b572fd2de3d8f7cdcc';
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET || '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';
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || 'atkn_b7f2568feeda8144db28d581f11f30e5948f561928eeba999dd2a3b8f4513a56e';

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

const ADD_TO_CART_MUTATION = `
  mutation AddItemToCart($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// UTILITY: Make Shopify API Requests (using fetch)
// ============================================
async function shopifyRequest(query, variables = {}) {
  try {
    const response = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': AUTOMATION_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    const data = await response.json();

    if (data.errors) {
      console.error('GraphQL Errors:', data.errors);
      throw new Error(data.errors[0].message);
    }

    return data.data;
  } catch (error) {
    console.error('Shopify API Error:', error.message);
    throw error;
  }
}

// ============================================
// SIMPLE TEXT MATCHING - Find Best Product
// ============================================
function findBestMatch(searchQuery, products) {
  if (!products || products.length === 0) {
    return null;
  }

  const normalizedQuery = searchQuery.toLowerCase().trim();
  const queryWords = normalizedQuery.split(' ');

  const scoredProducts = products.map((product) => {
    const title = product.title.toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    let score = 0;
    queryWords.forEach((word) => {
      if (combined.includes(word)) {
        score += 1;
      }
    });

    if (title.includes(normalizedQuery)) {
      score += 5;
    }

    return { product, score };
  });

  scoredProducts.sort((a, b) => b.score - a.score);

  return scoredProducts[0]?.score > 0 ? scoredProducts[0].product : null;
}

// ============================================
// CORS Headers
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
  console.log('=== Voice-to-Cart Function Called ===');
  console.log('Method:', event.httpMethod);
  console.log('Body:', event.body);

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    console.log('Parsed body:', body);

    const { query, variantId, quantity = 1 } = body;

    // ============================================
    // VOICE SEARCH - Search for products
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

      // Search Shopify products
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

      // Find best match
      const bestMatch = findBestMatch(query, products);

      if (!bestMatch) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            message: `No suitable product match found for "${query}"`,
          }),
        };
      }

      console.log(`✅ Found Product: ${bestMatch.title}`);

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
    // ADD TO CART - Add product to cart
    // ============================================
    if (variantId) {
      console.log(`🛒 Adding to Cart: Variant ${variantId}, Qty: ${quantity}`);

      // Create cart with item
      const data = await shopifyRequest(ADD_TO_CART_MUTATION, {
        input: {
          lines: [
            {
              merchandiseId: variantId,
              quantity: parseInt(quantity),
            },
          ],
        },
      });

      const cart = data.cartCreate.cart;

      if (!cart) {
        throw new Error('Failed to create cart');
      }

      console.log(`✅ Cart Created: ${cart.checkoutUrl}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          cartUrl: cart.checkoutUrl,
          message: 'Product added to cart successfully!',
        }),
      };
    }

    // ============================================
    // DEFAULT - Health check
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
    console.error('❌ Function Error:', error);
    console.error('Error stack:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Server error',
        error: error.message,
        stack: error.stack,
      }),
    };
  }
};
