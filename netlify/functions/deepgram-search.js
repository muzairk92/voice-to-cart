// netlify/functions/deepgram-search.js
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const AUTOMATION_TOKEN = process.env.AUTOMATION_TOKEN ;

const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($searchQuery: String!) {
    products(first: 5, query: $searchQuery) {
      edges {
        node {
          id title handle
          priceRange { minVariantPrice { amount } }
          images(first: 1) { edges { node { url } } }
          variants(first: 20) { edges { node { id title } } }
        }
      }
    }
  }
`;

async function shopifyRequest(query, variables = {}) {
  const response = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': AUTOMATION_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()).data;
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  try {
    const body = JSON.parse(event.body);
    const audioBase64 = body.audioBase64;
    const mimeType = body.mimeType || 'audio/webm';

    if (!audioBase64) throw new Error("No audio data provided");

    // 1. Send Audio to Deepgram
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const deepgramRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': mimeType
      },
      body: audioBuffer
    });

    const deepgramData = await deepgramRes.json();
    const transcript = deepgramData.results?.channels[0]?.alternatives[0]?.transcript;

    if (!transcript) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "Could not understand audio." }) };
    }
    console.log(`🎤 Deepgram Heard: "${transcript}"`);

    // 2. Search Shopify with Transcript (Same Smart Routing Logic)
    const searchData = await shopifyRequest(SEARCH_PRODUCTS_QUERY, { searchQuery: transcript.trim() });
    const products = searchData.products.edges.map(e => e.node);

    if (products.length === 0) return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: `No products found for "${transcript}".` }) };

    const bestMatch = products[0];
    const variants = bestMatch.variants.edges.map(v => v.node);
    let variantMatchFound = false;
    let selectedVariantId = variants[0].id;

    if (variants.length > 1) {
      const queryLower = transcript.toLowerCase();
      const matchedVariant = variants.find(v => v.title.toLowerCase() !== 'default title' && queryLower.includes(v.title.toLowerCase()));
      if (matchedVariant) { selectedVariantId = matchedVariant.id; variantMatchFound = true; }
    }

    if (products.length > 1 && !variantMatchFound) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'redirect', url: `https://${SHOPIFY_STORE}/search?q=${encodeURIComponent(transcript)}` }) };
    } 
    else if (variants.length > 1 && !variantMatchFound) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'redirect', url: `https://${SHOPIFY_STORE}/products/${bestMatch.handle}` }) };
    } 
    else {
      return {
        statusCode: 200, headers, body: JSON.stringify({
          success: true, action: 'modal',
          product: {
            title: variantMatchFound ? `${bestMatch.title} - ${variants.find(v=>v.id===selectedVariantId).title}` : bestMatch.title,
            image: bestMatch.images?.edges[0]?.node?.url || null,
            price: bestMatch.priceRange.minVariantPrice.amount,
            variantId: selectedVariantId.match(/\/(\d+)$/)[1]
          }
        })
      };
    }
  } catch (error) {
    console.error('❌ Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
