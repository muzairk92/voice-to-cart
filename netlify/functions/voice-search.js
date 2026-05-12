// netlify/functions/voice-search.js
// Smart Fuzzy Matching for Product Search (Simple, Fast, Reliable)

const SHOPIFY_STORE = process.env.SHOPIFY_STORE || 'genfury.myshopify.com';
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN || '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';

console.log('=== Voice-to-Cart with Smart Fuzzy Matching ===');
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
  
  console.log(`🔍 Fuzzy matching "${queryLower}" (words: ${queryWords.join(', ')})`);
  
  const scored = allProducts
    .map((product) => {
      const titleLower = product.title.toLowerCase();
      const descLower = (product.description || '').toLowerCase();
      
      let score = 0;
      
      // PRIORITY 1: Exact title match
      if (titleLower === queryLower) {
        score = 100000;
        console.log(`  ✓ Exact match: ${product.title}`);
      }
      // PRIORITY 2: Phrase match in title (consecutive words)
      else if (titleLower.includes(queryLower)) {
        score = 50000;
        console.log(`  ✓ Phrase match: ${product.title}`);
      }
      // PRIORITY 3: ALL query words must be in title
      else {
        const allWordsInTitle = queryWords.every(word => titleLower.includes(word));
        
        if (allWordsInTitle) {
          // Bonus: products with all words in title
          score = 10000;
          
          // Extra bonus if first word matches first word of title
          const titleWords = titleLower.split(/\s+/);
          if (titleWords[0].includes(queryWords[0])) {
            score += 5000;
          }
          
          console.log(`  ✓ All words in title: ${product.title}`);
        } else {
          // Partial match - only if most words match
          const matchedWords = queryWords.filter(word => titleLower.includes(word)).length;
          const matchRatio = matchedWords / queryWords.length;
          
          if (matchRatio >= 0.75) { // At least 75% of words match
            score = 1000 * matchRatio;
            console.log(`  ~ Partial match (${Math.round(matchRatio * 100)}%): ${product.title}`);
          }
        }
      }
      
      return { product, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1); // Return only the TOP match
  
  if (scored.length > 0) {
    console.log(`✅ Best match: ${scored[0].product.title} (score: ${scored[0].score})`);
  } else {
    console.log(`❌ No suitable matches found`);
  }
  
  return scored.length > 0 ? scored[0].product : null;
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

    console.log('✅ API request successful');
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
  console.log('\n=== Voice-to-Cart Function Called ===');
  console.log('Method:', event.httpMethod);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { query, variantId, quantity = 1 } = body;

    // ============================================
    // VOICE SEARCH - SMART FUZZY MATCHING
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
        // Get all products
        console.log('📦 Fetching all products...');
        const data = await shopifyRequest(GET_ALL_PRODUCTS_QUERY, { first: 250 });
        const allProducts = data.products.edges.map((edge) => edge.node);
        console.log(`Total products in store: ${allProducts.length}`);
        
        // Smart fuzzy match - returns best match
        const bestMatch = matchProducts(query, allProducts);

        if (!bestMatch) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({
              success: false,
              message: `No products found for "${query}"`,
            }),
          };
        }

        console.log(`✅ Best Match: ${bestMatch.title}`);

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
