const axios = require('axios');
const { chromium } = require('playwright');

const token = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const accounts = process.env.ACCOUNTS;

if (!accounts) {
  console.log('❌ 未配置账号');
  process.exit(1);
}

// 解析多个账号，支持逗号或分号分隔
const accountList = accounts.split(/[,;]/).map(account => {
  const [email, pass] = account.split(":").map(s => s.trim());
  return { email, pass };
}).filter(acc => acc.email && acc.pass);

if (accountList.length === 0) {
  console.log('❌ 账号格式错误，应为 email1:password1,email2:password2');
  process.exit(1);
}

async function sendTelegram(message) {
  if (!token || !chatId) return;

  const now = new Date();
  const hkTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timeStr = hkTime.toISOString().replace('T', ' ').substr(0, 19) + " HKT";

  const fullMessage = `🎉 Luneshost 登录通知\n\n登录时间：${timeStr}\n\n${message}`;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: fullMessage
    }, { timeout: 10000 });
    console.log('✅ Telegram 通知发送成功');
  } catch (e) {
    console.log('⚠️ Telegram 发送失败');
  }
}

async function loginWithAccount(email, pass) {
  console.log(`\n🚀 开始登录账号: ${email}`);
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  let page;
  let result = { email, success: false, message: '' };
  
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    
    console.log(`📱 ${email} - 正在访问网站...`);
    await page.goto('https://betadash.lunes.host/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log(`📝 ${email} - 填写邮箱...`);
    await page.fill('input[name="Email"], input[type="text"]', email);
    await page.waitForTimeout(1000);
    
    console.log(`🔒 ${email} - 填写密码...`);
    await page.fill('input[name="Password"], input[type="password"]', pass);
    await page.waitForTimeout(1000);

    // 检查 Cloudflare 验证
    console.log(`🛡️ ${email} - 检查 Cloudflare 验证...`);
    try {
      await page.waitForFunction(() => {
        const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
        if (!iframe) {
          // 如果没有 iframe，可能意味着不需要验证，或者验证方式已改变
          console.log(`🛡️ ${email} - 未检测到 Cloudflare iframe，可能无需验证...`);
          return true; // 假设无需验证，继续执行
        }
        // 如果找到 iframe，则检查其内部是否验证成功
        const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
        const isSuccess = iframeDocument.querySelector('#success-i') && iframeDocument.querySelector('#success-text');
        if(isSuccess) {
            console.log(`🛡️ ${email} - Cloudflare iframe 内已找到成功标志。`);
        }
        return isSuccess;
      }, null, { timeout: 45000 }); // 延长超时以应对慢速验证
      console.log(`✅ ${email} - Cloudflare 验证通过。`);
    } catch (error) {
      console.log(`❌ ${email} - Cloudflare 验证超时或失败。将尝试截图保存证据。`);
      await page.screenshot({ path: `cloudflare_error_${email}.png` });
      throw new Error('Cloudflare verification failed or timed out.');
    }
    
    console.log(`📤 ${email} - 提交登录...`);
    await page.waitForSelector('button:has-text("Submit"), input[type="submit"]', { timeout: 15000 });
    await page.click('button:has-text("Submit"), input[type="submit"]');
    
    // 等待登录成功或失败的标志性元素出现
    await page.waitForSelector('h1:has-text("Manage Account"), [class*="error"], [class*="alert"]', { timeout: 30000 });

    // 检查最终结果是成功还是失败
    const successElement = await page.$('h1:has-text("Manage Account")');
    if (successElement) {
        console.log(`✅ ${email} - 登录成功`);
        result.success = true;
        result.message = `✅ ${email} 登录成功`;
    } else {
        const errorElement = await page.$('[class*="error"], [class*="alert"]');
        const errorMessage = errorElement ? await errorElement.textContent() : '未知错误';
        throw new Error(`登录失败: ${errorMessage.trim()}`);
    }
    
  } catch (e) {
    console.log(`❌ ${email} - 登录异常: ${e.message}`);
    result.message = `❌ ${email} 登录异常: ${e.message}`;
  } finally {
    if (page) await page.close();
    await browser.close();
  }
  
  return result;
}

async function main() {
  console.log(`🔍 发现 ${accountList.length} 个账号需要登录`);
  
  const results = [];
  
  for (let i = 0; i < accountList.length; i++) {
    const { email, pass } = accountList[i];
    console.log(`\n📋 处理第 ${i + 1}/${accountList.length} 个账号: ${email}`);
    
    const result = await loginWithAccount(email, pass);
    results.push(result);
    
    // 如果不是最后一个账号，等待一下再处理下一个
    if (i < accountList.length - 1) {
      console.log('⏳ 等待3秒后处理下一个账号...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // 汇总所有结果并发送一条消息
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  let summaryMessage = `📊 登录汇总: ${successCount}/${totalCount} 个账号成功\n\n`;
  
  results.forEach(result => {
    summaryMessage += `${result.message}\n`;
  });
  
  await sendTelegram(summaryMessage);
  
  console.log('\n✅ 所有账号处理完成！');
}

main().catch(console.error);
