// netlify/functions/voice-search.js
// DeepSeek V4 AI-powered product matching

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || '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';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

console.log('=== Voice-to-Cart with DeepSeek AI Initialized ===');
console.log('Store:', SHOPIFY_STORE);
console.log('DeepSeek API Key:', DEEPSEEK_API_KEY ? 'Set ✓' : 'Missing ✗');

// ============================================
// SHOPIFY GraphQL QUERIES
// ============================================
const GET_ALL_PRODUCTS_QUERY = `
  query GetAllProducts($first: Int!) {
    products(first: $first) {
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
// USE DEEPSEEK AI TO MATCH PRODUCTS
// ============================================
async function findProductWithAI(searchQuery, products) {
  console.log(`🤖 Using DeepSeek V4 to find best match for: "${searchQuery}"`);

  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  if (!products || products.length === 0) {
    throw new Error('No products available to match');
  }

  try {
    // Format products for AI analysis
    const productList = products
      .map((p, idx) => 
        `${idx + 1}. ${p.title}\n   Description: ${p.description || 'N/A'}\n   Price: $${p.priceRange.minVariantPrice.amount}`
      )
      .join('\n\n');

    const systemPrompt = `You are a product matching expert for an online store selling backpacks and outdoor gear.
    
Given a customer's voice query, analyze the available products and return ONLY the product number (1-${products.length}) that best matches their intent.

Rules:
- Consider color, size, style, and use case mentioned in the query
- Match intent, not just keywords
- Return ONLY the number, nothing else
- If no suitable match, return 0`;

    const userPrompt = `Customer query: "${searchQuery}"

Available products:
${productList}

Return only the product number (or 0 if no match):`;

    console.log('📤 Calling DeepSeek API...');

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
        max_tokens: 10,
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
      console.log('No suitable match found');
      return null;
    }

    const bestMatch = products[productIndex];
    console.log(`✅ AI Selected: ${bestMatch.title}`);

    return bestMatch;
  } catch (error) {
    console.error('❌ DeepSeek Error:', error.message);
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
  console.log('\n=== Voice-to-Cart Function Called ===');
  console.log('Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { query, variantId, quantity = 1 } = body;

    // ============================================
    // VOICE SEARCH - AI-POWERED
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
        // Get ALL products from Shopify
        console.log('📦 Fetching all products from Shopify...');
        const data = await shopifyRequest(GET_ALL_PRODUCTS_QUERY, { first: 250 });
        const products = data.products.edges.map((edge) => edge.node);

        console.log(`Found ${products.length} products`);

        if (products.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              success: false,
              message: 'No products available',
            }),
          };
        }

        // Use DeepSeek AI to find best match
        const bestMatch = await findProductWithAI(query, products);

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
