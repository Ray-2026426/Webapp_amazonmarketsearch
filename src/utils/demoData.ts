import type { Product, HistoryRecord } from './parser';

/**
 * 演示数据：模拟美国站薄枕头（Thin Pillow）品类的市场格局。
 * 数据为虚构，仅供新用户预览 APP 功能。
 */

const months = ['202601', '202602', '202603', '202604', '202605', '202606', '202607'];

const DEMO_PRODUCTS: Product[] = [
  {
    asin: 'B0FH4SBYH4', sku: 'THIN-2.75-STD', brand: 'Huhu Sleep', title: 'Thin Memory Foam Pillow for Stomach Sleepers - 2.75 Inch Low Profile Flat Pillows',
    image: 'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US200_.jpg', monthlySales: 1240, monthlyRevenue: 61950, price: 49.97, rating: 4.1, reviewCount: 33, reviewGrowth: 8.2,
    sellerCount: 1, weight: 0.91, volume: 3200, launchDate: '202507', daysSinceLaunch: 210, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 6.12, subBsr: 702, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0GHMGQLP7', sku: 'THIN-KG-1.75', brand: 'Huhu Sleep', title: 'Thin Memory Foam Pillow - 1.75 Inch Ultra Low Profile King Size',
    image: 'https://m.media-amazon.com/images/I/31aS3LWEqUL._AC_US200_.jpg', monthlySales: 320, monthlyRevenue: 17500, price: 54.97, rating: 3.9, reviewCount: 12, reviewGrowth: 3.1,
    sellerCount: 1, weight: 1.1, volume: 4100, launchDate: '202509', daysSinceLaunch: 150, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 7.80, subBsr: 1800, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0FS1LC7SJ', sku: 'CANBOX-THIN-STD', brand: 'CANBOX', title: 'Thin Memory Foam Pillow, Low Profile Firm Pillow for Stomach and Back Sleepers',
    image: 'https://m.media-amazon.com/images/I/41zq0S0mV+L._AC_US200_.jpg', monthlySales: 5800, monthlyRevenue: 197000, price: 33.99, rating: 4.3, reviewCount: 358, reviewGrowth: 42.5,
    sellerCount: 1, weight: 0.85, volume: 3000, launchDate: '202406', daysSinceLaunch: 580, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 5.58, subBsr: 85, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0CBG2T9L1', sku: 'MINUPWELL-STD', brand: 'MINUPWELL', title: 'Thin Memory Foam Pillow 2.5" Low Profile Pillow for Sleeping, Cooling Gel Infused',
    image: 'https://m.media-amazon.com/images/I/41abcDe1234._AC_US200_.jpg', monthlySales: 3200, monthlyRevenue: 112000, price: 34.99, rating: 4.2, reviewCount: 210, reviewGrowth: 28.1,
    sellerCount: 2, weight: 0.82, volume: 2900, launchDate: '202410', daysSinceLaunch: 460, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 5.35, subBsr: 145, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0FRM1KXFT', sku: 'BYYEAR-2.5-STD', brand: 'ByYear', title: 'Thin Pillow for Stomach Sleepers 2.5" Memory Foam Pillow Low Profile Cooling',
    image: 'https://m.media-amazon.com/images/I/41xyzW5678._AC_US200_.jpg', monthlySales: 2100, monthlyRevenue: 77700, price: 36.99, rating: 4.5, reviewCount: 420, reviewGrowth: 35.0,
    sellerCount: 1, weight: 0.88, volume: 3100, launchDate: '202501', daysSinceLaunch: 380, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 5.72, subBsr: 210, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DG5X7Y2Z', sku: 'ELITESLEEP-THIN', brand: 'EliteSleep', title: 'Low Profile Memory Foam Pillow 2.25" Thin Pillow with Bamboo Cover - Cooling & Breathable',
    image: 'https://m.media-amazon.com/images/I/51test1111._AC_US200_.jpg', monthlySales: 950, monthlyRevenue: 36000, price: 37.99, rating: 4.0, reviewCount: 68, reviewGrowth: 15.3,
    sellerCount: 1, weight: 0.95, volume: 3400, launchDate: '202507', daysSinceLaunch: 200, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 5.95, subBsr: 890, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0BM9QN3LP', sku: 'SLEEPZEN-2.5', brand: 'SleepZen', title: 'Thin Memory Foam Pillow for Sleeping, 2.5 Inch Low Profile, Orthopedic Support',
    image: 'https://m.media-amazon.com/images/I/41test2222._AC_US200_.jpg', monthlySales: 4600, monthlyRevenue: 170000, price: 36.99, rating: 4.4, reviewCount: 892, reviewGrowth: 65.0,
    sellerCount: 1, weight: 0.90, volume: 3250, launchDate: '202402', daysSinceLaunch: 650, buyBoxType: 'FBA', sellerLocation: 'US', fbaFee: 5.42, subBsr: 68, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0CN8GT4KL', sku: 'DREAMFOAM-STD', brand: 'DreamFoam', title: 'Thin Pillow 2.4" Low Profile Memory Foam Pillow for Side & Back Sleepers',
    image: 'https://m.media-amazon.com/images/I/51test3333._AC_US200_.jpg', monthlySales: 780, monthlyRevenue: 27200, price: 34.99, rating: 4.1, reviewCount: 145, reviewGrowth: 12.7,
    sellerCount: 3, weight: 1.02, volume: 3700, launchDate: '202502', daysSinceLaunch: 340, buyBoxType: 'FBM', sellerLocation: 'CN', fbaFee: 0, subBsr: 1200, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0CP2RK6MN', sku: 'CLOUDREST-3.0', brand: 'CloudRest', title: '3 Inch Low Profile Memory Foam Pillow, Thin Pillow for Back Sleepers, Cooling',
    image: 'https://m.media-amazon.com/images/I/41test4444._AC_US200_.jpg', monthlySales: 1550, monthlyRevenue: 62000, price: 39.99, rating: 4.3, reviewCount: 275, reviewGrowth: 22.0,
    sellerCount: 1, weight: 1.05, volume: 3800, launchDate: '202406', daysSinceLaunch: 580, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 6.05, subBsr: 340, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DQ8PL9WR', sku: 'SOFTBED-2.0', brand: 'SoftBed', title: 'Ultra Thin Pillow 2.0" Slim Memory Foam Pillow for Stomach Sleepers',
    image: 'https://m.media-amazon.com/images/I/41test5555._AC_US200_.jpg', monthlySales: 610, monthlyRevenue: 22500, price: 36.99, rating: 3.8, reviewCount: 47, reviewGrowth: 5.5,
    sellerCount: 1, weight: 0.78, volume: 2750, launchDate: '202508', daysSinceLaunch: 170, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 5.20, subBsr: 2200, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DJ1X4B8P', sku: 'LUXREST-2.8', brand: 'LuxRest', title: 'Memory Foam Thin Pillow 2.8" Low Profile with Adjustable Loft - Premium',
    image: 'https://m.media-amazon.com/images/I/41test6666._AC_US200_.jpg', monthlySales: 2800, monthlyRevenue: 154000, price: 54.99, rating: 4.6, reviewCount: 630, reviewGrowth: 48.0,
    sellerCount: 1, weight: 1.15, volume: 4200, launchDate: '202311', daysSinceLaunch: 750, buyBoxType: 'FBA', sellerLocation: 'US', fbaFee: 7.12, subBsr: 52, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DN7KC2TV', sku: 'COZYBED-2.5', brand: 'CozyBed', title: '2.5 Inch Thin Memory Foam Pillow for Sleeping, Cooling Gel, Washable Cover',
    image: 'https://m.media-amazon.com/images/I/41test7777._AC_US200_.jpg', monthlySales: 4200, monthlyRevenue: 147000, price: 34.99, rating: 4.2, reviewCount: 510, reviewGrowth: 55.0,
    sellerCount: 2, weight: 0.92, volume: 3350, launchDate: '202404', daysSinceLaunch: 600, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 5.50, subBsr: 92, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DP3YF6HQ', sku: 'PLUSHNEST-3.2', brand: 'PlushNest', title: 'Thin Memory Foam Pillow 3.2" Low Profile with Charcoal Infused Foam',
    image: 'https://m.media-amazon.com/images/I/41test8888._AC_US200_.jpg', monthlySales: 1100, monthlyRevenue: 42800, price: 38.99, rating: 4.0, reviewCount: 92, reviewGrowth: 9.8,
    sellerCount: 1, weight: 1.08, volume: 3900, launchDate: '202506', daysSinceLaunch: 230, buyBoxType: 'FBA', sellerLocation: 'CN', fbaFee: 6.25, subBsr: 670, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DS6WQ1JK', sku: 'BAMBOOREST-2.2', brand: 'BambooRest', title: 'Ultra Thin 2.2" Memory Foam Pillow with Organic Bamboo Cover - Hypoallergenic',
    image: 'https://m.media-amazon.com/images/I/41test9999._AC_US200_.jpg', monthlySales: 380, monthlyRevenue: 14800, price: 38.99, rating: 3.7, reviewCount: 22, reviewGrowth: 4.5,
    sellerCount: 1, weight: 0.80, volume: 2800, launchDate: '202510', daysSinceLaunch: 120, buyBoxType: 'FBM', sellerLocation: 'CN', fbaFee: 0, subBsr: 3500, subCategory: 'Bed Pillows',
  },
  {
    asin: 'B0DY7L4M2R', sku: 'ELEVATESLEEP-4.0', brand: 'ElevateSleep', title: 'Thin Cooling Pillow 4.0" Low Profile with Copper Infusion, Adjustable',
    image: 'https://m.media-amazon.com/images/I/41test0000._AC_US200_.jpg', monthlySales: 1950, monthlyRevenue: 116000, price: 59.99, rating: 4.5, reviewCount: 380, reviewGrowth: 32.0,
    sellerCount: 1, weight: 1.35, volume: 4800, launchDate: '202401', daysSinceLaunch: 720, buyBoxType: 'FBA', sellerLocation: 'US', fbaFee: 8.15, subBsr: 160, subCategory: 'Bed Pillows',
  },
];

/** 每月的销量/收入/价格波动数据 */
function makeHistory(product: Product): HistoryRecord {
  const baseSales = product.monthlySales;
  const basePrice = product.price;
  const volatility = baseSales < 1000 ? 0.25 : baseSales < 2500 ? 0.18 : 0.12;

  const records: Record<string, { sales: number; revenue: number; price: number }> = {};

  let prevSales = Math.round(baseSales * (0.6 + Math.random() * 0.3));
  let prevPrice = basePrice;

  for (const m of months) {
    const noise = 1 + (Math.random() - 0.5) * volatility * 2;
    const salesGrowth = 1 + (Math.random() - 0.45) * 0.08;
    const sales = Math.max(10, Math.round(prevSales * noise * salesGrowth));
    const priceVar = prevPrice * (1 + (Math.random() - 0.48) * 0.04);
    const price = Math.round(Math.max(basePrice * 0.85, Math.min(basePrice * 1.15, priceVar)) * 100) / 100;
    const revenue = Math.round(sales * price);

    records[m] = { sales, revenue, price };
    prevSales = sales;
    prevPrice = price;
  }

  return { asin: product.asin, history: records };
}

export function getDemoData() {
  return {
    products: DEMO_PRODUCTS,
    history: DEMO_PRODUCTS.map(makeHistory),
    months: [...months],
    marketplace: { code: 'US', domain: 'amazon.com' },
    sourceLabel: '示例数据：美国站薄枕头市场',
  };
}
