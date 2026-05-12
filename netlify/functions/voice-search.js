// netlify/functions/voice-search.js
// DeepSeek V4 AI + Smart Fuzzy Matching for product search

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || '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';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

console.log('=== Voice-to-Cart with DeepSeek AI + Fuzzy Match ===');
console.log('Store:', SHOPIFY_STORE);

// ============================================
// SHOPIFY GraphQL - GET ALL PRODUCTS
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
// SMART FUZZY MATCHING FUNCTION
// ============================================
function matchProducts(query, allProducts) {
  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
  
  console.log(`🔍 Smart matching "${queryLower}" against ${allProducts.length} products`);
  
  const scored = allProducts
    .map((product) => {
      const titleLower = product.title.toLowerCase();
      const descLower = (product.description || '').toLowerCase();
      const combined = `${titleLower} ${descLower}`;
      
      let score = 0;
      
      // Exact title match = highest priority
      if (titleLower === queryLower) {
        score += 1000;
      }
      
      // Phrase match in title
      if (titleLower.includes(queryLower)) {
        score += 500;
      }
      
      // Count word matches
      queryWords.forEach((word) => {
        if (word.length > 2) {
          // Match in title
          if (titleLower.includes(word)) {
            score += 100;
          }
          // Match in description
          if (descLower.includes(word) && !titleLower.includes(word)) {
            score += 20;
          }
        }
      });
      
      return { product, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  
  console.log(`✅ Found ${scored.length} matching products`);
  
  return scored.map((item) => item.product);
}

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
    console.log(`Only one match, returning: ${products[0].title}`);
    return products[0];
  }

  try {
    // Format products for AI analysis
    const productList = products
      .map((p, idx) => 
        `${idx + 1}. ${p.title}\n   Description: ${p.description || 'N/A'}\n   Price: $${p.priceRange.minVariantPrice.amount}`
      )
      .join('\n\n');

    const systemPrompt = `You are a product matching expert. Given a customer's voice query and a list of matching products, select the BEST match.

PRIORITY RULES (in order):
1. Exact brand AND model match (e.g., "Hustle 6.0" → find "Hustle Backpack 6.0")
2. Partial exact match (e.g., "Hustle" in title)
3. All keywords present in product
4. Closest match by description

Return ONLY the product number (1-${products.length}) that best matches the query.
- Return ONLY the number (e.g., "1"), nothing else
- If multiple options have similar scores, prefer the first one`;

    const userPrompt = `Customer query: "${searchQuery}"

Available matching products:
${productList}

Best matching product number:`;

    console.log('📤 Calling DeepSeek for refinement...');

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
        temperature: 0.2,
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
      console.log('AI out of range, returning first match');
      return products[0];
    }

    const bestMatch = products[productIndex];
    console.log(`✅ AI Selected: ${bestMatch.title}`);

    return bestMatch;
  } catch (error) {
    console.error('⚠️ DeepSeek Error:', error.message);
    // Fallback to first match
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
    // VOICE SEARCH - SMART FUZZY + AI REFINEMENT
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
        // Step 1: Get all products
        console.log('📦 Fetching all products...');
        const data = await shopifyRequest(GET_ALL_PRODUCTS_QUERY, { first: 250 });
        const allProducts = data.products.edges.map((edge) => edge.node);
        console.log(`Total products in store: ${allProducts.length}`);
        
        // Step 2: Smart fuzzy matching
        const matchedProducts = matchProducts(query, allProducts);

        if (matchedProducts.length === 0) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              success: false,
              message: `No products found for "${query}"`,
            }),
          };
        }

        // Step 3: Use DeepSeek AI to pick the best from matches
        const bestMatch = await findBestProductWithAI(query, matchedProducts);

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

        console.log(`✅ Cart URL: ${addToCartUrl}`);

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
