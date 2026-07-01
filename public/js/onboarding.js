/* ═══ public/js/onboarding.js ═══ */
// ════════════════════════ ONBOARDING TUTORIAL ════════════════════════
var _TAB_TUTORIALS = {
  home: {
    title: 'خانه',
    steps: [
      {icon:'☀️', title:'امروز من', text:'مراکزی که برای امروز برنامه‌ریزی کردی — مستقیم دسترسی داری'},
      {icon:'🎯', title:'اولویت‌بندی هوشمند', text:'سیستم بر اساس پتانسیل و تاخیر، مهم‌ترین مراکز برای پیگیری رو اول نشون می‌ده'},
      {icon:'🔴', title:'پیگیری معوق', text:'مراکزی که تاریخ فالوآپشون گذشته — باید اول پیگیری بشن'},
      {icon:'📋', title:'بدون تاریخ', text:'مراکزی که هنوز تاریخ پیگیری ندارن — ردیف‌های نارنجی در جدول'},
    ]
  },
  provinces: {
    title: 'استان‌ها',
    steps: [
      {icon:'📞', title:'پانل تماس سریع', text:'دکمه 📞 کنار نام هر مرکز — آخرین یادداشت + ثبت تماس + تغییر فالوآپ بدون باز کردن مدال کامل'},
      {icon:'⊟', title:'نمای فشرده', text:'دکمه ⊟ بالای جدول — ستون‌های کم‌اهمیت (نوع، سرنخ، هفته) رو مخفی می‌کنه'},
      {icon:'+امروز', title:'اضافه به برنامه امروز', text:'دکمه +امروز کنار ستون هفته — یک‌کلیک مرکز رو به برنامه همین امروز اضافه می‌کنه'},
      {icon:'📅', title:'فالوآپ سریع', text:'دکمه‌های +۱ / +۳ / +۷ روز کنار تاریخ — بدون تایپ، فالوآپ رو جلو می‌بری'},
      {icon:'🔍', title:'فیلتر هوشمند', text:'فیلترهای overdue / nofollowup / stalled — مراکز مهم رو فوری پیدا کن'},
      {icon:'🌡️', title:'هیت‌مپ استان', text:'رنگ کارت استان: سبز = وضع خوب، زرد = متوسط، قرمز = معوق زیاد'},
    ]
  },
  weekplan: {
    title: 'برنامه هفته',
    steps: [
      {icon:'✅', title:'نتیجه اجباری', text:'وقتی «انجام شد» می‌زنی باید یکی رو انتخاب کنی: 🔄 پیگیری (تاریخ بعدی اجباری) / ✅ قرارداد / ❌ غیرفعال'},
      {icon:'📊', title:'KPI خودکار', text:'هر «انجام شد» در برنامه هفته، خودکار در KPI شمرده می‌شه — دیگه نیازی به ثبت دستی نیست'},
      {icon:'🎯', title:'درگ و دراپ', text:'مراکز رو بین روزهای مختلف هفته بکش و رها کن — تاریخ برنامه خودکار آپدیت می‌شه'},
      {icon:'👤', title:'فیلتر کارشناس', text:'با فیلتر بالا برنامه هر کارشناس رو جداگانه ببین — مدیر می‌تونه هر کارشناس رو انتخاب کنه'},
      {icon:'📞🤝', title:'شمارنده تماس', text:'در جدول مراکز badge سبز/آبی نشون می‌ده چند تماس و مراجعه برای اون مرکز ثبت شده'},
    ]
  },
  tasks: {
    title: 'وظایف',
    steps: [
      {icon:'🔄', title:'وظایف تکرارشونده', text:'تو مدال وظیفه، تکرار روزانه / هفتگی / ماهانه تنظیم کن — بعد از انجام، نسخه بعدی خودکار ساخته می‌شه'},
      {icon:'📋', title:'زیروظیفه ۳ سطحی', text:'«+ زیروظیفه» رو توی هر وظیفه بزن — تا ۳ سطح تودرتو پشتیبانی می‌شه'},
      {icon:'⚙️', title:'ستون‌های سفارشی', text:'دکمه ⚙️ ستون‌ها — هر کارشناس می‌تونه ستون‌های کانبان خودش رو بسازه'},
      {icon:'🔗', title:'لینک به مرکز', text:'هر وظیفه می‌تونه به یک مرکز وصل بشه — برای پیگیری فروش یک مشتری خاص'},
      {icon:'🏷️', title:'اولویت و مالک', text:'اولویت ۱-۳ و مالک وظیفه — مدیر می‌تونه به هر کارشناس وظیفه تخصیص بده'},
    ]
  },
  calendar: {
    title: 'تقویم',
    steps: [
      {icon:'📅', title:'سه نما', text:'تقویم ماهانه / هفتگی / لیستی — با دکمه‌های بالا جابجا شو'},
      {icon:'🔵', title:'رویدادها', text:'رویدادهای دستی رو با کلیک روی روز تقویم اضافه کن'},
      {icon:'🔴', title:'فالوآپ‌ها', text:'تاریخ‌های پیگیری مراکز در تقویم نمایش داده می‌شن'},
    ]
  },
  checklist: {
    title: 'چک‌لیست',
    steps: [
      {icon:'☑️', title:'امتیاز روزانه', text:'هر آیتم که تیک بزنی امتیاز می‌گیری — هدف ۱۰۰٪ روزانه'},
      {icon:'📊', title:'پیشرفت هفتگی', text:'نمودار امتیاز هر روز هفته رو بالای صفحه ببین'},
    ]
  },
  kpi: {
    title: 'KPI',
    steps: [
      {icon:'↑↓', title:'مقایسه هفتگی', text:'هفته جاری vs هفته قبل — فلش‌های سبز/قرمز تغییر رو نشون می‌دن'},
      {icon:'🚨', title:'هشدار صفر فعالیت', text:'اگه کارشناسی این هفته هیچ فعالیتی نداشته، بنر قرمز نشون داده می‌شه'},
      {icon:'📞', title:'ثبت از هفته‌برنامه', text:'هر «انجام شد» در برنامه هفته، خودکار اینجا شمرده می‌شه — بدون ثبت دستی'},
      {icon:'🎯', title:'اهداف ماهانه', text:'روی دکمه «هدف‌گذاری» هر کارشناس کلیک کن و هدف ماهانه تنظیم کن'},
    ]
  },
  manager: {
    title: 'بررسی مدیر',
    steps: [
      {icon:'👤', title:'کلیک روی کارشناس', text:'روی هر ردیف کارشناس کلیک کن — گزارش کامل با تمام مراکز و آخرین یادداشت‌ها'},
      {icon:'🔴', title:'معوق کلیک‌پذیر', text:'روی عدد معوق کلیک کن — لیست همه مراکز معوق اون کارشناس با یک‌کلیک'},
      {icon:'📊', title:'ماتریس پایپ‌لاین', text:'جدول پتانسیل × وضعیت — ببین هر کارشناس چقدر مرکز P1 در مذاکره داره'},
      {icon:'📋', title:'خلاصه امروز', text:'پایین صفحه: همه فعالیت‌های امروز تیم رو یکجا ببین'},
    ]
  },
};

var _obCurrentStep = 0;

function _onboardingDay(){
  try{
    var fu = DB.settings && DB.settings.firstUse && DB.settings.firstUse[currentUser];
    if(!fu) return 1;
    var parts = fu.split('/');
    var fuMs = jMs(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
    var todayParts = todayStr().split('/');
    var todayMs = jMs(parseInt(todayParts[0]), parseInt(todayParts[1]), parseInt(todayParts[2]));
    var diff = Math.floor((todayMs - fuMs) / 86400000);
    return Math.max(1, Math.min(7, diff + 1));
  }catch(e){ return 1; }
}

// ── Tab Tutorial System ──────────────────────────────────────────────────────
function _obGetTabCount(tab){
  try{
    var data=JSON.parse(localStorage.getItem('ob_tab_v3')||'{}');
    return ((data[currentUser]||{})[tab])||0;
  }catch(e){return 0;}
}
function _obIncrTabCount(tab){
  try{
    var data=JSON.parse(localStorage.getItem('ob_tab_v3')||'{}');
    if(!data[currentUser])data[currentUser]={};
    data[currentUser][tab]=(_obGetTabCount(tab))+1;
    localStorage.setItem('ob_tab_v3',JSON.stringify(data));
  }catch(e){}
}
function _showTabTutorial(tab){
  return;
}
function _dismissTabTutorial(tab){
  _obIncrTabCount(tab);
  var el=document.getElementById('_tabTutPanel');
  if(el){el.style.animation='fadeOut .2s ease forwards';setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},220);}
}
function _initOnboarding(){
  // Legacy: no-op (replaced by tab tutorial system)
}
function _shouldShowOnboarding(){return false;}
// ════════════════════════ END ONBOARDING ═════════════════════════════

// initSSE moved to core.js

// _sseReloadDB moved to core.js

// ═══════════════════════════════════════════════════════════════════
