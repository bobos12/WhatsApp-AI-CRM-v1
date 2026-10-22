// ─────────────────────────────────────────────────────────────────────────────
// Bilingual marketing content for the landing page.
// Self-contained (not wired into the global i18n namespaces) so the marketing
// site can evolve independently. Keyed by language; the page reads the active
// language from useLanguage() and re-renders on switch — RTL flips seamlessly.
// ─────────────────────────────────────────────────────────────────────────────

export type LandingLang = 'en' | 'ar'

export interface LandingContent {
  nav: {
    links: { id: string; label: string }[]
    signIn: string
    getStarted: string
    menu: string
  }
  hero: {
    eyebrow: string
    titleLine1: string
    titleLine2: string
    subtitle: string
    ctaPrimary: string
    ctaSecondary: string
    reassurance: string
    /** The animated conversation beside the headline. */
    chat: {
      contactName: string
      status: string
      today: string
      inbound1: string
      outbound1: string
      inbound2: string
      aiLabel: string
      typing: string
      composer: string
      repliedIn: string
    }
    /** The CRM record that updates as the conversation plays. */
    crm: {
      label: string
      stage: string
      stageFrom: string
      stageTo: string
      owner: string
      ownerFrom: string
      ownerTo: string
      value: string
      valueAmount: string
      tag: string
    }
  }
  stats: { value: number; suffix: string; label: string }[]
  industries: {
    title: string
    items: { key: string; label: string }[]
  }
  /** Product tour — one tab per screen, each backed by a product screenshot. */
  tour: {
    eyebrow: string
    title: string
    titleMuted: string
    subtitle: string
    items: { key: string; label: string; title: string; desc: string; bullets: string[] }[]
  }
  ai: {
    eyebrow: string
    title: string
    titleMuted: string
    subtitle: string
    capabilities: { key: string; title: string; desc: string }[]
    firstReply: string
    resolved: string
  }
  workflow: {
    title: string
    subtitle: string
    steps: { key: string; title: string; desc: string }[]
  }
  mobile: {
    eyebrow: string
    title: string
    titleMuted: string
    subtitle: string
    bullets: string[]
    install: string
  }
  testimonials: {
    eyebrow: string
    title: string
    items: { quote: string; author: string; role: string }[]
  }
  pricing: {
    eyebrow: string
    title: string
    subtitle: string
    perMonth: string
    mostPopular: string
    plans: {
      key: string
      name: string
      price: string
      sub: string
      features: string[]
      cta: string
      highlight: boolean
    }[]
  }
  faq: {
    eyebrow: string
    title: string
    subtitle: string
    askUs: string
    items: { q: string; a: string }[]
  }
  finalCta: {
    title: string
    subtitle: string
    primary: string
    reassurance: string
  }
  footer: {
    tagline: string
    columns: { title: string; links: string[] }[]
    rights: string
    disclaimer: string
    badges: string[]
  }
  appInstalled: string
}

export const LANDING: Record<LandingLang, LandingContent> = {
  // ═══════════════════════════════════════════ ENGLISH ═══════════════════════
  en: {
    nav: {
      links: [
        { id: 'product', label: 'Product' },
        { id: 'ai', label: 'AI' },
        { id: 'customers', label: 'Customers' },
        { id: 'pricing', label: 'Pricing' },
        { id: 'faq', label: 'FAQ' },
      ],
      signIn: 'Sign in',
      getStarted: 'Get started',
      menu: 'Menu',
    },
    hero: {
      eyebrow: 'WhatsApp CRM for the Gulf',
      titleLine1: 'Your business runs on WhatsApp.',
      titleLine2: 'Run WhatsApp like a business.',
      subtitle:
        'One inbox for your whole team, an AI assistant that answers in Arabic and English around the clock, and a CRM that remembers every customer — in one place.',
      ctaPrimary: 'Talk to us on WhatsApp',
      ctaSecondary: 'See the product',
      reassurance: 'Set up in 10 minutes · Arabic & English · Cancel anytime',
      chat: {
        contactName: 'Sara Al-Otaibi',
        status: 'online',
        today: 'Today',
        inbound1: 'Hi! Is my order ready?',
        outbound1: 'Yes — order #2847 is confirmed and ships today. You’ll get tracking by 6 PM.',
        inbound2: 'Perfect, thank you!',
        aiLabel: 'AI assistant',
        typing: 'typing…',
        composer: 'Type a reply…',
        repliedIn: 'AI replied in 2s',
      },
      crm: {
        label: 'Contact record',
        stage: 'Stage',
        stageFrom: 'New',
        stageTo: 'Qualified',
        owner: 'Owner',
        ownerFrom: 'AI assistant',
        ownerTo: 'Omar · Sales',
        value: 'Deal value',
        valueAmount: 'SAR 1,240',
        tag: 'Repeat customer',
      },
    },
    stats: [
      { value: 500, suffix: '+', label: 'businesses onboard' },
      { value: 2, suffix: 'M+', label: 'messages a day' },
      { value: 99.9, suffix: '%', label: 'uptime SLA' },
      { value: 10, suffix: 'x', label: 'faster responses' },
    ],
    industries: {
      title: 'Built for businesses that live on WhatsApp',
      items: [
        { key: 'restaurants', label: 'Restaurants & cafés' },
        { key: 'clinics', label: 'Clinics' },
        { key: 'realestate', label: 'Real estate' },
        { key: 'retail', label: 'Retail' },
        { key: 'ecommerce', label: 'E-commerce' },
        { key: 'education', label: 'Education' },
        { key: 'automotive', label: 'Automotive' },
        { key: 'agencies', label: 'Agencies' },
      ],
    },
    tour: {
      eyebrow: 'Product',
      title: 'Everything your team does on WhatsApp,',
      titleMuted: 'in one place.',
      subtitle: 'Pick a tool to see how it works.',
      items: [
        {
          key: 'inbox',
          label: 'Shared inbox',
          title: 'One number. Your whole team.',
          desc: 'Sales, support and operations work the same WhatsApp number without two people answering the same customer.',
          bullets: ['Round-robin assignment inside working hours', 'Internal notes, tags and saved views', 'Full customer history beside every thread'],
        },
        {
          key: 'automation',
          label: 'Automation',
          title: 'Automate the follow-up.',
          desc: 'Trigger-based workflows qualify a lead, route it to the right team and chase it later — without anyone remembering to.',
          bullets: ['Triggers on real events, not schedules', 'Branches on score, language and working hours', 'Delays that cancel themselves when the customer replies'],
        },
        {
          key: 'deals',
          label: 'Pipeline',
          title: 'Turn chats into deals.',
          desc: 'A drag-and-drop board that tracks value by stage, so you can see where the money is stuck and who is sitting on it.',
          bullets: ['Stages that match how you actually sell', 'Value and conversion roll up automatically', 'AI-scored leads arrive already ranked'],
        },
        {
          key: 'broadcasts',
          label: 'Campaigns',
          title: 'Broadcast at scale.',
          desc: 'Thousands of segmented messages with per-recipient delivery tracking — and warm-up limits that keep your number alive.',
          bullets: ['Segment by tag, stage or custom field', 'Ban-safe send pacing enforced by the sender', 'Delivered, read and replied, per campaign'],
        },
        {
          key: 'analytics',
          label: 'Analytics',
          title: 'Measure everything.',
          desc: 'Response times, resolution rates, agent workload, campaign results and AI impact — on one board-ready screen.',
          bullets: ['First-response time per agent', 'Revenue traced back to the first message', 'What share of chats the AI closed alone'],
        },
      ],
    },
    ai: {
      eyebrow: 'AI',
      title: 'AI handles the busywork.',
      titleMuted: 'Your team closes the deals.',
      subtitle:
        'The assistant reads every conversation, understands intent in Arabic and English, and acts — so your people spend their time where it counts.',
      capabilities: [
        { key: 'replies', title: 'Smart auto-replies', desc: 'Instant, on-brand answers to common questions.' },
        { key: 'qualify', title: 'Lead qualification', desc: 'Scores and routes hot leads to the right agent.' },
        { key: 'summary', title: 'Conversation summaries', desc: 'One-line recaps of long chats before you reply.' },
        { key: 'sentiment', title: 'Sentiment detection', desc: 'Flags unhappy customers before they churn.' },
        { key: 'suggest', title: 'Suggested replies', desc: 'Drafted responses your agents send in a tap.' },
        { key: 'translate', title: 'Arabic ↔ English', desc: 'Understands and replies fluently in both.' },
      ],
      firstReply: 'average AI first reply',
      resolved: 'resolved without an agent',
    },
    workflow: {
      title: 'From first message to closed deal',
      subtitle: 'Every step updates the next — automatically.',
      steps: [
        { key: 'customer', title: 'Customer messages', desc: 'Day or night, on the app they already use.' },
        { key: 'ai', title: 'AI responds', desc: 'Answers, qualifies and gathers context.' },
        { key: 'team', title: 'Team takes over', desc: 'Hot chats route to the right agent with full history.' },
        { key: 'crm', title: 'CRM stays in sync', desc: 'Contacts, deals and notes update themselves.' },
        { key: 'reports', title: 'Reports show growth', desc: 'See what works and what to scale.' },
      ],
    },
    mobile: {
      eyebrow: 'Mobile',
      title: 'Your inbox,',
      titleMuted: 'in your pocket.',
      subtitle: 'Install it like a native app. The same inbox, the same CRM, the same notifications — on the phone your team already carries.',
      bullets: [
        'Installable app — no app store review',
        'Push alerts for hot leads and slow replies',
        'Keeps working offline and syncs on reconnect',
      ],
      install: 'Install the app',
    },
    testimonials: {
      eyebrow: 'Customers',
      title: 'Trusted by teams across the Gulf',
      items: [
        { quote: 'We went from juggling WhatsApp on personal phones to routing 3,000 conversations a day through one team inbox. Response time dropped by 80%.', author: 'Sara Al-Rashid', role: 'Head of Support, NovaMart' },
        { quote: 'The broadcast templates render exactly like real WhatsApp messages — finally a tool that does not embarrass us in front of customers.', author: 'Khalid Al-Harbi', role: 'Growth Lead, Tamkeen' },
        { quote: 'The AI handles 70% of inbound questions before a human even sees them. Our small team now performs like an enterprise call center.', author: 'Noura Al-Qahtani', role: 'CEO, FastShip Logistics' },
      ],
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Simple, transparent pricing',
      subtitle: 'Start free. Scale when you grow. No hidden fees, cancel anytime.',
      perMonth: '/ month',
      mostPopular: 'Most popular',
      plans: [
        { key: 'starter', name: 'Starter', price: 'Free', sub: 'Free forever for small teams', features: ['1 WhatsApp number', 'Up to 500 contacts', '3 team members', 'Basic automation', 'Community support'], cta: 'Get started free', highlight: false },
        { key: 'pro', name: 'Professional', price: '199 ﷼', sub: 'Billed monthly · save 20% yearly', features: ['3 WhatsApp numbers', 'Up to 10,000 contacts', 'Unlimited team members', 'AI assistant + advanced automation', 'Broadcast campaigns', 'Priority support'], cta: 'Start free trial', highlight: true },
        { key: 'enterprise', name: 'Enterprise', price: 'Custom', sub: 'Self-hosted or managed cloud', features: ['Unlimited numbers & contacts', 'White-label option', 'Custom integrations', 'Dedicated infrastructure', 'SLA + onboarding manager'], cta: 'Contact sales', highlight: false },
      ],
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Questions, answered',
      subtitle: 'Everything you need to know before getting started.',
      askUs: 'Still have a question? Ask us on WhatsApp',
      items: [
        { q: 'Do I need the official WhatsApp Business API?', a: 'You can start in minutes by scanning a QR code with our Baileys provider, or connect the official Meta Business API for higher volume and verified templates. The platform supports both — and fails over automatically.' },
        { q: 'Does it fully support Arabic?', a: 'Yes. The entire platform, the AI assistant and message templates are fully bilingual with native right-to-left support, built for Gulf and Arab markets.' },
        { q: 'How long does setup take?', a: 'Most businesses are live in under 10 minutes — connect your number, import contacts, and start messaging. No developers required.' },
        { q: 'Is my data secure and private?', a: 'Your data is encrypted in transit and at rest, hosted in compliant infrastructure. Enterprise plans can be fully self-hosted on your own servers.' },
        { q: 'Can I migrate my existing contacts?', a: 'Absolutely. Import via CSV, sync from your current CRM, or let conversations auto-create contacts as customers message you.' },
      ],
    },
    finalCta: {
      title: 'Ready to make WhatsApp your #1 sales channel?',
      subtitle: 'Join businesses across the Gulf delivering faster support, smarter campaigns and more closed deals — every day.',
      primary: 'Talk to us on WhatsApp',
      reassurance: 'Set up in 10 minutes · Arabic & English · Cancel anytime',
    },
    footer: {
      tagline: 'The WhatsApp CRM for businesses across the Gulf.',
      columns: [
        { title: 'Product', links: ['Features', 'AI Assistant', 'Pricing', 'Roadmap'] },
        { title: 'Solutions', links: ['Restaurants', 'Healthcare', 'Real Estate', 'E-commerce'] },
        { title: 'Company', links: ['About', 'Privacy', 'Terms', 'Contact'] },
      ],
      rights: 'All rights reserved.',
      disclaimer: 'Not affiliated with Meta Platforms Inc.',
      badges: ['GDPR ready', '99.9% uptime SLA', 'Hosted in-region'],
    },
    appInstalled: 'App installed',
  },

  // ═══════════════════════════════════════════ ARABIC ════════════════════════
  ar: {
    nav: {
      links: [
        { id: 'product', label: 'المنتج' },
        { id: 'ai', label: 'الذكاء الاصطناعي' },
        { id: 'customers', label: 'عملاؤنا' },
        { id: 'pricing', label: 'الأسعار' },
        { id: 'faq', label: 'الأسئلة' },
      ],
      signIn: 'تسجيل الدخول',
      getStarted: 'ابدأ الآن',
      menu: 'القائمة',
    },
    hero: {
      eyebrow: 'نظام واتساب لإدارة العملاء في الخليج',
      titleLine1: 'عملك يقوم على واتساب.',
      titleLine2: 'فأدِره كما تُدار الشركات.',
      subtitle:
        'صندوق وارد واحد لفريقك كله، ومساعد ذكي يرد بالعربية والإنجليزية على مدار الساعة، ونظام عملاء يحفظ تفاصيل كل عميل — في مكان واحد.',
      ctaPrimary: 'تحدّث معنا على واتساب',
      ctaSecondary: 'شاهد المنتج',
      reassurance: 'الإعداد خلال 10 دقائق · عربي وإنجليزي · إلغاء في أي وقت',
      chat: {
        contactName: 'سارة العتيبي',
        status: 'متصلة',
        today: 'اليوم',
        inbound1: 'مرحبًا! هل طلبي جاهز؟',
        outbound1: 'أهلًا سارة — تم تأكيد الطلب رقم 2847 وسيُشحن اليوم، ويصلك رابط التتبّع قبل 6 مساءً.',
        inbound2: 'ممتاز، شكرًا جزيلًا!',
        aiLabel: 'المساعد الذكي',
        typing: 'يكتب…',
        composer: 'اكتب ردًا…',
        repliedIn: 'ردّ المساعد خلال ثانيتين',
      },
      crm: {
        label: 'ملف العميل',
        stage: 'المرحلة',
        stageFrom: 'جديد',
        stageTo: 'مؤهَّل',
        owner: 'المسؤول',
        ownerFrom: 'المساعد الذكي',
        ownerTo: 'عمر · المبيعات',
        value: 'قيمة الصفقة',
        valueAmount: '1,240 ر.س',
        tag: 'عميل متكرر',
      },
    },
    stats: [
      { value: 500, suffix: '+', label: 'شركة منضمة' },
      { value: 2, suffix: 'M+', label: 'رسالة يوميًا' },
      { value: 99.9, suffix: '%', label: 'جاهزية الخدمة' },
      { value: 10, suffix: 'x', label: 'ردود أسرع' },
    ],
    industries: {
      title: 'صُمّم للأعمال التي تعيش على واتساب',
      items: [
        { key: 'restaurants', label: 'المطاعم والمقاهي' },
        { key: 'clinics', label: 'العيادات' },
        { key: 'realestate', label: 'العقارات' },
        { key: 'retail', label: 'التجزئة' },
        { key: 'ecommerce', label: 'التجارة الإلكترونية' },
        { key: 'education', label: 'التعليم' },
        { key: 'automotive', label: 'السيارات' },
        { key: 'agencies', label: 'الوكالات' },
      ],
    },
    tour: {
      eyebrow: 'المنتج',
      title: 'كل ما يفعله فريقك على واتساب،',
      titleMuted: 'في مكان واحد.',
      subtitle: 'اختر أداة لترى كيف تعمل.',
      items: [
        {
          key: 'inbox',
          label: 'الصندوق المشترك',
          title: 'رقم واحد. فريقك بالكامل.',
          desc: 'المبيعات والدعم والعمليات يعملون على نفس رقم الواتساب دون أن يرد شخصان على العميل نفسه.',
          bullets: ['توزيع دوري ضمن ساعات العمل', 'ملاحظات داخلية ووسوم وعروض محفوظة', 'سجل العميل كاملًا بجانب كل محادثة'],
        },
        {
          key: 'automation',
          label: 'الأتمتة',
          title: 'أتمت المتابعة.',
          desc: 'مسارات تعمل بالمحفزات تؤهّل العميل وتوجّهه للفريق المناسب وتتابعه لاحقًا — دون أن يتذكر أحد ذلك.',
          bullets: ['محفزات على أحداث حقيقية لا على جداول', 'تفرّع حسب التقييم واللغة وساعات العمل', 'تأخير يُلغى تلقائيًا عند رد العميل'],
        },
        {
          key: 'deals',
          label: 'خط الصفقات',
          title: 'حوّل المحادثات إلى صفقات.',
          desc: 'لوحة بالسحب والإفلات تتابع القيمة حسب المرحلة، لترى أين تتعطل الأموال ومن المسؤول عنها.',
          bullets: ['مراحل تطابق طريقة بيعك فعليًا', 'القيمة ونسبة التحويل تُحتسب تلقائيًا', 'العملاء المؤهّلون بالذكاء الاصطناعي يصلون مُرتّبين'],
        },
        {
          key: 'broadcasts',
          label: 'الحملات',
          title: 'أرسل على نطاق واسع.',
          desc: 'آلاف الرسائل المُقسّمة مع تتبّع التسليم لكل مستلم — وحدود إحماء تحافظ على رقمك.',
          bullets: ['تقسيم حسب الوسم أو المرحلة أو الحقول المخصصة', 'إيقاع إرسال آمن يمنع الحظر', 'التسليم والقراءة والرد لكل حملة'],
        },
        {
          key: 'analytics',
          label: 'التحليلات',
          title: 'قِس كل شيء.',
          desc: 'أزمنة الرد ونسب الحل وأحمال الموظفين ونتائج الحملات وأثر الذكاء الاصطناعي — في شاشة واحدة جاهزة للعرض.',
          bullets: ['زمن أول رد لكل موظف', 'الإيرادات متتبَّعة حتى أول رسالة', 'نسبة المحادثات التي أغلقها الذكاء الاصطناعي وحده'],
        },
      ],
    },
    ai: {
      eyebrow: 'الذكاء الاصطناعي',
      title: 'الذكاء الاصطناعي يتولّى الروتين.',
      titleMuted: 'وفريقك يُغلق الصفقات.',
      subtitle:
        'يقرأ المساعد كل محادثة، ويفهم النية بالعربية والإنجليزية، ويتصرّف — ليتفرّغ فريقك لما يصنع الفرق.',
      capabilities: [
        { key: 'replies', title: 'ردود تلقائية ذكية', desc: 'إجابات فورية ومتوافقة مع هوية علامتك.' },
        { key: 'qualify', title: 'تأهيل العملاء', desc: 'تقييم وتوجيه العملاء المهمين للموظف المناسب.' },
        { key: 'summary', title: 'تلخيص المحادثات', desc: 'ملخص بسطر واحد للمحادثات الطويلة قبل ردّك.' },
        { key: 'sentiment', title: 'تحليل المشاعر', desc: 'ينبّهك للعملاء غير الراضين قبل أن يغادروا.' },
        { key: 'suggest', title: 'ردود مقترحة', desc: 'ردود جاهزة يرسلها فريقك بنقرة.' },
        { key: 'translate', title: 'عربي ↔ إنجليزي', desc: 'يفهم ويردّ بطلاقة في كلتا اللغتين.' },
      ],
      firstReply: 'متوسط أول رد من المساعد',
      resolved: 'محادثات لا تصل لموظف',
    },
    workflow: {
      title: 'من أول رسالة إلى إتمام الصفقة',
      subtitle: 'كل خطوة تُحدّث ما يليها — تلقائيًا.',
      steps: [
        { key: 'customer', title: 'العميل يراسلك', desc: 'ليلًا أو نهارًا، على التطبيق الذي يستخدمه أصلًا.' },
        { key: 'ai', title: 'المساعد يرد', desc: 'يجيب ويؤهّل ويجمع السياق.' },
        { key: 'team', title: 'الفريق يستلم', desc: 'المحادثات المهمة تصل للموظف المناسب بكامل السجل.' },
        { key: 'crm', title: 'النظام متزامن', desc: 'جهات الاتصال والصفقات والملاحظات تُحدَّث تلقائيًا.' },
        { key: 'reports', title: 'التقارير تكشف النمو', desc: 'اعرف ما ينجح وما يستحق التوسّع.' },
      ],
    },
    mobile: {
      eyebrow: 'الجوال',
      title: 'صندوق واردك،',
      titleMuted: 'في جيبك.',
      subtitle: 'ثبّته كتطبيق أصلي. نفس الصندوق ونفس نظام العملاء ونفس الإشعارات — على الجوال الذي يحمله فريقك أصلًا.',
      bullets: [
        'تطبيق قابل للتثبيت — بلا مراجعة متجر',
        'تنبيهات فورية للعملاء المهمين والردود المتأخرة',
        'يعمل دون اتصال ويزامن عند العودة',
      ],
      install: 'ثبّت التطبيق',
    },
    testimonials: {
      eyebrow: 'عملاؤنا',
      title: 'فرق في أنحاء الخليج تعتمد علينا',
      items: [
        { quote: 'انتقلنا من إدارة واتساب على هواتف شخصية إلى توجيه 3000 محادثة يوميًا عبر صندوق وارد واحد. انخفض زمن الرد بنسبة 80%.', author: 'سارة الراشد', role: 'مديرة الدعم، نوفامارت' },
        { quote: 'قوالب الحملات تظهر تمامًا كرسائل واتساب الحقيقية — أخيرًا أداة لا تُحرجنا أمام العملاء.', author: 'خالد الحربي', role: 'مدير النمو، تمكين' },
        { quote: 'يتولّى الذكاء الاصطناعي 70% من الأسئلة الواردة قبل أن يراها موظف. فريقنا الصغير صار يؤدّي كمركز اتصال مؤسسي.', author: 'نورة القحطاني', role: 'الرئيسة التنفيذية، فاست شيب' },
      ],
    },
    pricing: {
      eyebrow: 'الأسعار',
      title: 'أسعار بسيطة وشفافة',
      subtitle: 'ابدأ مجانًا. توسّع عند النمو. بدون رسوم خفية، وإلغاء في أي وقت.',
      perMonth: '/ شهريًا',
      mostPopular: 'الأكثر اختيارًا',
      plans: [
        { key: 'starter', name: 'المبتدئ', price: 'مجاني', sub: 'مجاني للأبد للفرق الصغيرة', features: ['رقم واتساب واحد', 'حتى 500 جهة اتصال', '3 أعضاء فريق', 'أتمتة أساسية', 'دعم المجتمع'], cta: 'ابدأ مجانًا', highlight: false },
        { key: 'pro', name: 'الاحترافي', price: '199 ﷼', sub: 'فوترة شهرية · وفّر 20% سنويًا', features: ['3 أرقام واتساب', 'حتى 10,000 جهة اتصال', 'أعضاء فريق بلا حدود', 'مساعد ذكي + أتمتة متقدمة', 'حملات جماعية', 'دعم ذو أولوية'], cta: 'ابدأ تجربة مجانية', highlight: true },
        { key: 'enterprise', name: 'المؤسسات', price: 'مخصص', sub: 'استضافة ذاتية أو سحابة مُدارة', features: ['أرقام وجهات اتصال بلا حدود', 'خيار العلامة البيضاء', 'تكاملات مخصصة', 'بنية تحتية مخصصة', 'اتفاقية مستوى خدمة + مدير إعداد'], cta: 'تواصل مع المبيعات', highlight: false },
      ],
    },
    faq: {
      eyebrow: 'الأسئلة الشائعة',
      title: 'إجابات لأسئلتك',
      subtitle: 'كل ما تحتاج معرفته قبل أن تبدأ.',
      askUs: 'لديك سؤال آخر؟ اسألنا على واتساب',
      items: [
        { q: 'هل أحتاج واجهة واتساب للأعمال الرسمية؟', a: 'يمكنك البدء خلال دقائق بمسح رمز QR عبر مزوّد Baileys، أو ربط واجهة Meta الرسمية للحجم الأكبر والقوالب الموثّقة. المنصة تدعم الاثنين — وتبدّل بينهما تلقائيًا.' },
        { q: 'هل يدعم اللغة العربية بالكامل؟', a: 'نعم. المنصة بالكامل والمساعد الذكي وقوالب الرسائل ثنائية اللغة مع دعم أصيل للكتابة من اليمين لليسار، ومبنية للسوق الخليجي والعربي.' },
        { q: 'كم يستغرق الإعداد؟', a: 'معظم الشركات تعمل خلال أقل من 10 دقائق — اربط رقمك واستورد جهات الاتصال وابدأ المراسلة. بدون مطوّرين.' },
        { q: 'هل بياناتي آمنة وخاصة؟', a: 'بياناتك مشفّرة أثناء النقل والتخزين، ومستضافة في بنية تحتية متوافقة. خطط المؤسسات يمكن استضافتها ذاتيًا بالكامل على خوادمك.' },
        { q: 'هل يمكنني نقل جهات اتصالي الحالية؟', a: 'بالتأكيد. استورد عبر ملف CSV، أو زامن من نظامك الحالي، أو دع المحادثات تنشئ جهات الاتصال تلقائيًا عند مراسلة العملاء.' },
      ],
    },
    finalCta: {
      title: 'جاهز لتجعل واتساب قناة مبيعاتك الأولى؟',
      subtitle: 'انضم لشركات في أنحاء الخليج تقدّم دعمًا أسرع وحملات أذكى وصفقات أكثر — كل يوم.',
      primary: 'تحدّث معنا على واتساب',
      reassurance: 'الإعداد خلال 10 دقائق · عربي وإنجليزي · إلغاء في أي وقت',
    },
    footer: {
      tagline: 'نظام واتساب لإدارة العملاء للأعمال في أنحاء الخليج.',
      columns: [
        { title: 'المنتج', links: ['المميزات', 'المساعد الذكي', 'الأسعار', 'خارطة الطريق'] },
        { title: 'الحلول', links: ['المطاعم', 'الرعاية الصحية', 'العقارات', 'التجارة الإلكترونية'] },
        { title: 'الشركة', links: ['من نحن', 'الخصوصية', 'الشروط', 'تواصل معنا'] },
      ],
      rights: 'جميع الحقوق محفوظة.',
      disclaimer: 'غير تابع لشركة Meta Platforms Inc.',
      badges: ['متوافق مع GDPR', 'جاهزية 99.9%', 'استضافة داخل المنطقة'],
    },
    appInstalled: 'التطبيق مثبّت',
  },
}
