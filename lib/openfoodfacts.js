// lib/openfoodfacts.js

// Busca produtos por nome/marca
export async function searchProduct(query) {
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NutriScan - nutri-scan.prototype@example.com'
      }
    });
    
    const data = await response.json();
    return data.products || [];
  } catch (error) {
    console.error('Erro Open Food Facts:', error);
    return [];
  }
}

// Busca por código de barras (se a IA detetar)
export async function getProductByBarcode(barcode) {
  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NutriScan - nutri-scan.prototype@example.com'
      }
    });
    
    const data = await response.json();
    return data.status === 1 ? data.product : null;
  } catch (error) {
    console.error('Erro Open Food Facts:', error);
    return null;
  }
}

// Extrai dados nutricionais padronizados
export function extractNutritionData(product) {
  if (!product) return null;
  
  const nutrition = product.nutriments || {};
  const servingSize = product.serving_size || '100g';
  
  return {
    nome: product.product_name || 'Produto não identificado',
    marca: product.brands || 'Desconhecida',
    calorias: nutrition['energy-kcal_100g'] || 0,
    proteinas: nutrition.proteins_100g || 0,
    hidratos: nutrition.carbohydrates_100g || 0,
    gorduras: nutrition.fat_100g || 0,
    fibra: nutrition.fiber_100g || 0,
    porcao: servingSize,
    codigoBarras: product.code || null
  };
}
