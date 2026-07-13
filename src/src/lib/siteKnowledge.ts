import fs from 'fs';

export async function loadSiteKnowledge(): Promise<string> {
  try {
    // Vercel-এ ডিপ্লয়ের পর dist ফোল্ডারে llms.txt থাকে
    const filePath = './dist/llms.txt';
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    
    // লোকাল ডেভেলপমেন্টের জন্য
    const localPath = './llms.txt';
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath, 'utf-8');
    }
    
    return 'ওয়েবসাইট সম্পর্কে কোনো তথ্য পাওয়া যায়নি।';
  } catch (error) {
    console.error('কন্টেন্ট লোড করতে সমস্যা:', error);
    return 'কন্টেন্ট লোড করতে সমস্যা হয়েছে।';
  }
}