// netlify/functions/voice-search.js
// Voice Search API for Netlify Functions

const axios = require('axios');

// ============================================
// CONFIGURATION
// ============================================
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '983a67e105fdce76538ee7c588f6d321';
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET || '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';
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || 'atkn_8e2263970508af62a3d08423b91e2f934b168f87193b131a4a8856d76588 8ec0';

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
// UTILITY: Make Shopify API Requests
// ============================================
async function shopifyRequest(query, variables = {}) {
  try {
    const response = await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
      { query, variables },
      {
        headers: {
          'X-Shopify-Access-Token': AUTOMATION_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.errors) {
      console.error('GraphQL Errors:', response.data.errors);
      throw new Error(response.data.errors[0].message);
    }

    return response.data.data;
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
// NETLIFY FUNCTION: Voice Search
// ============================================
exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  try {
    const path = event.path;

    // ============================================
    // ROUTE: /voice-search - Search for products
    // ============================================
    if (path.includes('/voice-search') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { query } = body;

      if (!query || query.trim().length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            message: 'Search query is required',
          }),
        };
      }

      console.log(`🎤 Voice Search: "${query}"`);

      // Search Shopify products
      const data = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { query });
      const products = data.products.edges.map((edge) => edge.node);

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
    // ROUTE: /add-to-cart - Add product to cart
    // ============================================
    if (path.includes('/add-to-cart') && event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const { variantId, quantity = 1 } = body;

      if (!variantId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            message: 'Variant ID is required',
          }),
        };
      }

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
    // ROUTE: /health - Health check
    // ============================================
    if (path.includes('/health')) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'ok',
          message: 'Voice-to-Cart API is running',
          store: SHOPIFY_STORE,
        }),
      };
    }

    // 404 - Route not found
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Endpoint not found',
      }),
    };
  } catch (error) {
    console.error('Function Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'Server error',
        error: error.message,
      }),
    };
  }
};
