// netlify/functions/voice-search.js
// DeepSeek V4 AI-powered product matching (optimized for accuracy)

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || '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';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

console.log('=== Voice-to-Cart with DeepSeek AI Initialized ===');
console.log('Store:', SHOPIFY_STORE);

// ============================================
// SHOPIFY GraphQL QUERIES
// ============================================
const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($query: String!) {
    products(first: 20, query: $query) {
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
  console.log('📤 Making Shopify API request...');
  
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
// USE DEEPSEEK AI TO REFINE PRODUCT MATCH
// ============================================
async function findBestProductWithAI(searchQuery, products) {
  console.log(`🤖 Using DeepSeek V4 to refine match for: "${searchQuery}"`);

  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  if (!products || products.length === 0) {
    return null;
  }

  // If only one product, return it
  if (products.length === 1) {
    console.log(`Only one product found, returning: ${products[0].title}`);
    return products[0];
  }

  try {
    // Format products for AI analysis
    const productList = products
      .map((p, idx) => 
        `${idx + 1}. ${p.title}\n   Description: ${p.description || 'N/A'}\n   Price: $${p.priceRange.minVariantPrice.amount}`
      )
      .join('\n\n');

    const systemPrompt = `You are a product matching expert. Given a customer's voice query and a list of relevant products, select the BEST match.

Return ONLY the product number (1-${products.length}) that most closely matches the customer's intent.
- Consider color, size, style, and use case
- Match intent and description, not just keywords
- Return ONLY the number (e.g., "2"), nothing else`;

    const userPrompt = `Customer query: "${searchQuery}"

Available products:
${productList}

Best matching product number:`;

    console.log('📤 Calling DeepSeek API for refinement...');

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 5,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ DeepSeek Error:', data);
      throw new Error(data.error?.message || 'DeepSeek API error');
    }

    const aiResponse = data.choices[0].message.content.trim();
    console.log('🤖 DeepSeek response:', aiResponse);

    const productIndex = parseInt(aiResponse) - 1;

    if (productIndex < 0 || productIndex >= products.length) {
      // If AI can't decide, return the first match
      console.log('AI response out of range, returning first match');
      return products[0];
    }

    const bestMatch = products[productIndex];
    console.log(`✅ AI Selected: ${bestMatch.title}`);

    return bestMatch;
  } catch (error) {
    console.error('❌ DeepSeek Error:', error.message);
    // Fallback to first product if AI fails
    console.log('Falling back to first match');
    return products[0];
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
  console.log('\n=== Voice-to-Cart Function Called ===');
  console.log('Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { query, variantId, quantity = 1 } = body;

    // ============================================
    // VOICE SEARCH - HYBRID (Search + AI Refinement)
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
        // Step 1: Search for products matching the query
        console.log('🔍 Searching for products...');
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

        // Step 2: Use DeepSeek AI to pick the best from search results
        const bestMatch = await findBestProductWithAI(query, products);

        if (!bestMatch) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              success: false,
              message: `No suitable match found`,
            }),
          };
        }

        console.log(`✅ Returning: ${bestMatch.title}`);

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
    // ADD TO CART
    // ============================================
    if (variantId) {
      console.log(`🛒 Add to Cart: ${variantId}, Qty: ${quantity}`);

      try {
        const variantIdMatch = variantId.match(/\/(\d+)$/);
        if (!variantIdMatch) {
          throw new Error('Invalid variant ID format');
        }

        const numericVariantId = variantIdMatch[1];
        const addToCartUrl = `https://${SHOPIFY_STORE}/cart/add?id=${numericVariantId}&quantity=${quantity}`;

        console.log(`✅ Add to cart URL: ${addToCartUrl}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            checkoutUrl: addToCartUrl,
            message: 'Added to cart!',
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
        message: 'Voice-to-Cart API with DeepSeek AI is running',
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
