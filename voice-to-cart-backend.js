const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '983a67e105fdce76538ee7c588f6d321';
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET || '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';
const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || 'atkn_8e2263970508af62a3d08423b91e2f934b168f87193b131a4a8856d76588 8ec0';

// ============================================
// SHOPIFY GraphQL QUERY - Search Products
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
// SHOPIFY GraphQL QUERY - Get Checkout
// ============================================
const CREATE_CHECKOUT_MUTATION = `
  mutation CreateCheckout($input: CheckoutCreateInput!) {
    checkoutCreate(input: $input) {
      checkout {
        id
        webUrl
      }
      checkoutUserErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// SHOPIFY GraphQL QUERY - Add to Cart
// ============================================
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

  // Normalize search query
  const normalizedQuery = searchQuery.toLowerCase().trim();
  const queryWords = normalizedQuery.split(' ');

  // Score products based on keyword matches
  const scoredProducts = products.map((product) => {
    const title = product.title.toLowerCase();
    const description = (product.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    // Count matching words
    let score = 0;
    queryWords.forEach((word) => {
      if (combined.includes(word)) {
        score += 1;
      }
    });

    // Bonus for exact word matches in title
    if (title.includes(normalizedQuery)) {
      score += 5;
    }

    return { product, score };
  });

  // Sort by score and return highest
  scoredProducts.sort((a, b) => b.score - a.score);

  return scoredProducts[0]?.score > 0 ? scoredProducts[0].product : null;
}

// ============================================
// ENDPOINT: Search Products by Voice Query
// ============================================
app.post('/api/voice-search', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
    }

    console.log(`🎤 Voice Search: "${query}"`);

    // Search Shopify products
    const data = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { query });

    const products = data.products.edges.map((edge) => edge.node);

    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No products found for "${query}"`,
      });
    }

    // Find the best matching product
    const bestMatch = findBestMatch(query, products);

    if (!bestMatch) {
      return res.status(404).json({
        success: false,
        message: `No suitable product match found for "${query}"`,
      });
    }

    console.log(`✅ Found Product: ${bestMatch.title}`);

    return res.json({
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
    });
  } catch (error) {
    console.error('Voice Search Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to search products',
      error: error.message,
    });
  }
});

// ============================================
// ENDPOINT: Add Product to Cart
// ============================================
app.post('/api/add-to-cart', async (req, res) => {
  try {
    const { variantId, quantity = 1 } = req.body;

    if (!variantId) {
      return res.status(400).json({
        success: false,
        message: 'Variant ID is required',
      });
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

    return res.json({
      success: true,
      cartUrl: cart.checkoutUrl,
      message: 'Product added to cart successfully!',
    });
  } catch (error) {
    console.error('Add to Cart Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add product to cart',
      error: error.message,
    });
  }
});

// ============================================
// ENDPOINT: Health Check
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Voice-to-Cart API is running',
    store: SHOPIFY_STORE,
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🎤 VOICE-TO-CART API RUNNING        ║
║   Port: ${PORT}                             
║   Store: ${SHOPIFY_STORE}
║   Status: Ready                        ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;
