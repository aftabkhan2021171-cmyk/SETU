/**
 * SETU Multi-Language Engine.
 * Supports the 7 Sisters of North-East India (Assamese, Bengali, Manipuri, Mizo, Khasi, Bodo, Nagamese)
 * and far-off / regional languages (Punjabi, Hindi, Tamil, Telugu, Malayalam, Kannada, Odia, Marathi, English).
 */

import { useState, useEffect } from 'react';

export type LangCode =
  | 'en'   // English
  | 'as'   // Assamese (Assam)
  | 'bn'   // Bengali (Tripura / Assam / Bengal)
  | 'mni'  // Manipuri / Meitei (Manipur)
  | 'lus'  // Mizo (Mizoram)
  | 'kha'  // Khasi (Meghalaya)
  | 'brx'  // Bodo (Bodoland / Assam)
  | 'nag'  // Nagamese (Nagaland)
  | 'pa'   // Punjabi (Punjab)
  | 'hi'   // Hindi (Pan-India)
  | 'ta'   // Tamil (Tamil Nadu)
  | 'te'   // Telugu (Andhra / Telangana)
  | 'ml'   // Malayalam (Kerala)
  | 'kn'   // Kannada (Karnataka)
  | 'or'   // Odia (Odisha)
  | 'mr';  // Marathi (Maharashtra)

export interface LangMeta {
  code: LangCode;
  label: string;
  region: string;
}

export const LANGUAGES: LangMeta[] = [
  { code: 'en', label: 'English', region: 'Global' },
  // 7 Sisters of North-East India
  { code: 'as', label: 'অসমীয়া (Assamese)', region: 'Assam' },
  { code: 'bn', label: 'বাংলা (Bengali)', region: 'Tripura / Assam' },
  { code: 'mni', label: 'মৈতৈলোন্ (Manipuri)', region: 'Manipur' },
  { code: 'lus', label: 'Mizo ṭawng (Mizo)', region: 'Mizoram' },
  { code: 'kha', label: 'Ka Ktien Khasi (Khasi)', region: 'Meghalaya' },
  { code: 'brx', label: 'बड़ो (Bodo)', region: 'Bodoland / Assam' },
  { code: 'nag', label: 'Nagamese', region: 'Nagaland' },
  // Far-off regions
  { code: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)', region: 'Punjab / North' },
  { code: 'hi', label: 'हिन्दी (Hindi)', region: 'National / Central' },
  { code: 'ta', label: 'தமிழ் (Tamil)', region: 'Tamil Nadu / South' },
  { code: 'te', label: 'తెలుగు (Telugu)', region: 'Andhra / Telangana' },
  { code: 'ml', label: 'മലയാളം (Malayalam)', region: 'Kerala / South' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)', region: 'Karnataka / South' },
  { code: 'or', label: 'ଓଡ଼ିଆ (Odia)', region: 'Odisha / East' },
  { code: 'mr', label: 'मराठी (Marathi)', region: 'Maharashtra / West' }
];

export interface TranslationStrings {
  dashboard: string;
  vitals: string;
  doctorTriage: string;
  conflicts: string;
  syncManager: string;
  signOut: string;
  online: string;
  offline: string;
  patientsCount: string;
  pendingSync: string;
  searchPlaceholder: string;
  filterAll: string;
  stable: string;
  followUp: string;
  urgent: string;
  addPatient: string;
  exportCsv: string;
  fullName: string;
  age: string;
  locality: string;
  status: string;
  actions: string;
  recordVitals: string;
  edit: string;
  savePatient: string;
  cancel: string;
  customColumns: string;
  addColumn: string;
  duplicateDetected: string;
  updateExisting: string;
  registerAnyway: string;
  outdoorMode: string;
  darkMode: string;
  warmMode: string;
}

export const TRANSLATIONS: Record<LangCode, TranslationStrings> = {
  en: {
    dashboard: 'Field dashboard',
    vitals: 'Vitals',
    doctorTriage: 'Doctor triage',
    conflicts: 'Conflicts',
    syncManager: 'Sync manager',
    signOut: 'Sign out',
    online: 'Online',
    offline: 'Offline',
    patientsCount: 'Patients on this device',
    pendingSync: 'Changes waiting to sync',
    searchPlaceholder: 'Search name, ID, phone or locality...',
    filterAll: 'All Statuses',
    stable: 'Stable',
    followUp: 'Follow-up',
    urgent: 'Urgent',
    addPatient: 'Add patient',
    exportCsv: 'Export CSV',
    fullName: 'Full name',
    age: 'Age',
    locality: 'Locality / Village',
    status: 'Status',
    actions: 'Actions',
    recordVitals: 'Record vitals',
    edit: 'Edit',
    savePatient: 'Save Patient',
    cancel: 'Cancel',
    customColumns: 'Custom Information Columns',
    addColumn: '+ Add Column',
    duplicateDetected: 'Existing patient found! Prevent duplicate entry:',
    updateExisting: 'Open & Update Existing',
    registerAnyway: 'Register Anyway (Different Person)',
    outdoorMode: '☀️ Sunlight Mode',
    darkMode: '🌙 Dark Mode',
    warmMode: '🎨 Default Theme'
  },
  as: { // Assamese (Assam)
    dashboard: 'ফিল্ড ডেচবৰ্ড',
    vitals: 'স্বাস্থ্য লক্ষণ',
    doctorTriage: 'চিকিৎসক মূল্যায়ন',
    conflicts: 'তথ্য বিৰোধ',
    syncManager: 'ছিংক মেনেজাৰ',
    signOut: 'প্ৰস্থান কৰক',
    online: 'অনলাইন',
    offline: 'অফলাইন',
    patientsCount: 'এই যন্ত্ৰত থকা ৰোগী',
    pendingSync: 'ছিংকৰ অপেক্ষাত তথ্য',
    searchPlaceholder: 'নাম, চিনাক্তকৰণ বা গাওঁ বিচাৰক...',
    filterAll: 'সকলো অৱস্থা',
    stable: 'স্থিতিশীল',
    followUp: 'পুনৰীক্ষণ',
    urgent: 'জৰুৰী',
    addPatient: 'ৰোগী যোগ কৰক',
    exportCsv: 'CSV এক্সপ’ৰ্ট',
    fullName: 'সম্পূৰ্ণ নাম',
    age: 'বয়স',
    locality: 'স্থান / গাওঁ',
    status: 'অৱস্থা',
    actions: 'কাৰ্য্য',
    recordVitals: 'লক্ষণ লিপিবদ্ধ কৰক',
    edit: 'সম্পাদনা',
    savePatient: 'ৰোগী সংৰক্ষণ কৰক',
    cancel: 'বাতিল',
    customColumns: 'অতিৰিক্ত তথ্য স্তম্ভ',
    addColumn: '+ স্তম্ভ যোগ কৰক',
    duplicateDetected: 'পূৰ্বৰ ৰোগী পোৱা গৈছে! নকল তথ্য এৰাই চলক:',
    updateExisting: 'পূৰ্বৰ ৰোগী আপডেট কৰক',
    registerAnyway: 'নতুন ব্যক্তি হিচাপে ৰাখক',
    outdoorMode: '☀️ ৰ’দৰ মোড',
    darkMode: '🌙 অন্ধকাৰ মোড',
    warmMode: '🎨 মূল ৰূপ'
  },
  bn: { // Bengali (Tripura / Assam / Bengal)
    dashboard: 'ফিল্ড ড্যাশবোর্ড',
    vitals: 'স্বাস্থ্য লক্ষণ',
    doctorTriage: 'চিকিৎসক ট্রায়াজ',
    conflicts: 'তথ্য সংঘাত',
    syncManager: 'সিঙ্ক ম্যানেজার',
    signOut: 'লগআউট',
    online: 'অনলাইন',
    offline: 'অফলাইন',
    patientsCount: 'এই ডিভাইসের রোগী',
    pendingSync: 'সিঙ্ক অপেক্ষমান',
    searchPlaceholder: 'নাম, আইডি বা এলাকা অনুসন্ধান...',
    filterAll: 'সকল অবস্থা',
    stable: 'স্থিতিশীল',
    followUp: 'ফলো-আপ',
    urgent: 'জরুরী',
    addPatient: 'রোগী যোগ করুন',
    exportCsv: 'CSV ডাউনলোড',
    fullName: 'পূর্ণ নাম',
    age: 'বয়স',
    locality: 'এলাকা / গ্রাম',
    status: 'অবস্থা',
    actions: 'পদক্ষেপ',
    recordVitals: 'লক্ষণ রেকর্ড করুন',
    edit: 'সম্পাদনা',
    savePatient: 'সংরক্ষণ করুন',
    cancel: 'বাতিল',
    customColumns: 'কাস্টম তথ্য কলাম',
    addColumn: '+ কলাম যোগ করুন',
    duplicateDetected: 'একই নামের রোগী ইতিমধ্যে বিদ্যমান! ডুপ্লিকেট এড়ান:',
    updateExisting: 'বিদ্যমান রোগী আপডেট করুন',
    registerAnyway: 'ভিন্ন ব্যক্তি হিসেবে সেভ করুন',
    outdoorMode: '☀️ রোদের মোড',
    darkMode: '🌙 ডার্ক মোড',
    warmMode: '🎨 ডিফল্ট থিম'
  },
  mni: { // Manipuri / Meitei (Manipur)
    dashboard: 'ফিল্ড দেশবোর্দ',
    vitals: 'হকশেলগী শক্তম',
    doctorTriage: 'দাক্তর ত্ৰিয়াজ',
    conflicts: 'মরী লৈনবা ইপাউ',
    syncManager: 'সিঙ্ক মেনেজর',
    signOut: 'থোক্লবা',
    online: 'ওনলাইন',
    offline: 'ওফলাইন',
    patientsCount: 'ডিভাইস অসিগী অনাবা',
    pendingSync: 'সিঙ্ক তৌগদবা',
    searchPlaceholder: 'মিং, আইডি নত্ত্রগা খুঙ্গং থিবীউ...',
    filterAll: 'পুম্নমক',
    stable: 'নুংঙাইবা',
    followUp: 'অমুক হন্না যেংবা',
    urgent: 'য়াম্না কন্না মথৌ তাবা',
    addPatient: 'অনাবা হাপচিনবা',
    exportCsv: 'CSV এক্সপোর্ত',
    fullName: 'অচুম্বা মিং',
    age: 'চহী',
    locality: 'মফম / খুঙ্গং',
    status: 'ফিভম',
    actions: 'থবক',
    recordVitals: 'শক্তম ইশিনবা',
    edit: 'শেমদোকপা',
    savePatient: 'অনাবা সেভ তৌবা',
    cancel: 'তৌদবা',
    customColumns: 'অতোপ্পা ইপাউ কালাম',
    addColumn: '+ কালাম হাপচিনবা',
    duplicateDetected: 'অনাবা অসি মমাংদগী লৈরে! অমুক্কা হাপচিনগনু:',
    updateExisting: 'লৈরিবা অনাবা অপদেত তৌবা',
    registerAnyway: 'তোঙানবা মীওইনি সেভ তৌবা',
    outdoorMode: '☀️ নুমিৎ মোদ',
    darkMode: '🌙 অমম্বা মোদ',
    warmMode: '🎨 সেতু থিম'
  },
  lus: { // Mizo (Mizoram)
    dashboard: 'Field Dashboard',
    vitals: 'Hriselna dinhmun',
    doctorTriage: 'Daktawr endikna',
    conflicts: 'Thu inmil lo',
    syncManager: 'Sync Manager',
    signOut: 'Chhuak rawh',
    online: 'Online',
    offline: 'Offline',
    patientsCount: 'Damlo awm zat',
    pendingSync: 'Sync hmabak',
    searchPlaceholder: 'Hming, ID, khua zawnna...',
    filterAll: 'A vaiin',
    stable: 'Hrisel tha',
    followUp: 'Ennawn ngai',
    urgent: 'Hmanhmawhthlak',
    addPatient: 'Damlo thar dahna',
    exportCsv: 'CSV Export',
    fullName: 'Hming pum',
    age: 'Kum',
    locality: 'Khua / Veng',
    status: 'Dinhmun',
    actions: 'Tih theihte',
    recordVitals: 'Dinhmun ziahna',
    edit: 'Siamthatna',
    savePatient: 'Vawng tha rawh',
    cancel: 'Thulh',
    customColumns: 'Hriattirna dangte',
    addColumn: '+ Dah belhna',
    duplicateDetected: 'He hming ang hi a awm tawh! Dah nawn suh:',
    updateExisting: 'A awm sa siamtha rawh',
    registerAnyway: 'Mi dang a ni e tih nemnghet rawh',
    outdoorMode: '☀️ Ni en lai mode',
    darkMode: '🌙 Dark Mode',
    warmMode: '🎨 Pangngai'
  },
  kha: { // Khasi (Meghalaya)
    dashboard: 'Ka Dashboard',
    vitals: 'Ka Koit ka Khiah',
    doctorTriage: 'Jingpeit u Doktor',
    conflicts: 'Jingiapher jingtip',
    syncManager: 'Sync Manager',
    signOut: 'Mih noh',
    online: 'Online',
    offline: 'Offline',
    patientsCount: 'Ki nongpang ha kane ka phone',
    pendingSync: 'Ki ban sa sync',
    searchPlaceholder: 'Wad kyrteng, ID, shnong...',
    filterAll: 'Baroh',
    stable: 'Kaba biang',
    followUp: 'Ban peit biang',
    urgent: 'Kaba kyrkieh',
    addPatient: 'Pynrung nongpang',
    exportCsv: 'Pynmih CSV',
    fullName: 'Kyrteng pura',
    age: 'Rta',
    locality: 'Shnong / Dong',
    status: 'Ka jinglong',
    actions: 'Kam ban leh',
    recordVitals: 'Kyntiew jingtip',
    edit: 'Pynkylla',
    savePatient: 'Pynskhem',
    cancel: 'Sangeh',
    customColumns: 'Jingbatai shuh shuh',
    addColumn: '+ Pynrung Column',
    duplicateDetected: 'Don lypa une u nongpang! Wat pynrung ar sien:',
    updateExisting: 'Pynbha ia uba don lypa',
    registerAnyway: 'Uba pher u briew',
    outdoorMode: '☀️ Sngi Mode',
    darkMode: '🌙 Dum Mode',
    warmMode: '🎨 Riti Ba Rim'
  },
  brx: { // Bodo (Bodoland / Assam)
    dashboard: 'गाहाइ बिलाइ',
    vitals: 'देहा सावस्रि',
    doctorTriage: 'डाक्टर नायदिं',
    conflicts: 'गोरोन्थिफोर',
    syncManager: 'सिंक मेनेजार',
    signOut: 'ओंखारलां',
    online: 'अनलाइन',
    offline: 'अफलाइन',
    patientsCount: 'बे डिभाइसनि बेरामीफोर',
    pendingSync: 'सिंक जानो थानाय',
    searchPlaceholder: 'मुं, आइदि, गामि नागिर...',
    filterAll: 'गासैबो',
    stable: 'मोजां',
    followUp: 'नायफिननांगौ',
    urgent: 'गोनांथार',
    addPatient: 'बेरामी सोदेर',
    exportCsv: 'CSV दिहुन',
    fullName: 'गासै मुं',
    age: 'बैसो',
    locality: 'गामि / जायगा',
    status: 'थासारि',
    actions: 'हाबाफोर',
    recordVitals: 'सावस्रि लिर',
    edit: 'सोलाय',
    savePatient: 'थि खालाम',
    cancel: 'नेवसि',
    customColumns: 'गुबुन मिथिसार',
    addColumn: '+ खाम्फा सोदेर',
    duplicateDetected: 'बे मुंनि बेरामी दंखायो! खननै सोदेरनाङा:',
    updateExisting: 'थाखानायखौ मोजां खालाम',
    registerAnyway: 'गुबुन मानसि हिसाबै दोन',
    outdoorMode: '☀️ सानदुं मोद',
    darkMode: '🌙 खोमसि मोद',
    warmMode: '🎨 गुदि महर'
  },
  nag: { // Nagamese (Nagaland)
    dashboard: 'Field Dashboard',
    vitals: 'Health Chek',
    doctorTriage: 'Doktor Triage',
    conflicts: 'Ulta-pulta Record',
    syncManager: 'Sync Manager',
    signOut: 'Bahar Jabi',
    online: 'Online',
    offline: 'Offline',
    patientsCount: 'Phone te thaka bimar manu',
    pendingSync: 'Baki thaka sync',
    searchPlaceholder: 'Naam, ID, gaon bisari...',
    filterAll: 'Sob',
    stable: 'Bhal ase',
    followUp: 'Pichete sai lobi',
    urgent: 'Bishi joruri',
    addPatient: 'Notun bimar manu',
    exportCsv: 'CSV Ulao',
    fullName: 'Pura Naam',
    age: 'Umar',
    locality: 'Gaon / Jaga',
    status: 'Haal',
    actions: 'Kam',
    recordVitals: 'Vitals likhi lobi',
    edit: 'Bhal kora',
    savePatient: 'Basaikena rakhibi',
    cancel: 'Nalagibo',
    customColumns: 'Aro details',
    addColumn: '+ Column dhalibi',
    duplicateDetected: 'Etu naam laga manu agete ase! Dui bar nadhalibi:',
    updateExisting: 'Agete thaka tu update kora',
    registerAnyway: 'Alag manu ase eneka likhibi',
    outdoorMode: '☀️ Roud Mode',
    darkMode: '🌙 Andhera Mode',
    warmMode: '🎨 Normal'
  },
  pa: { // Punjabi (Punjab)
    dashboard: 'ਫੀਲਡ ਡੈਸ਼ਬੋਰਡ',
    vitals: 'ਸਰੀਰਕ ਮਾਪਦੰਡ (ਵਾਈਟਲਸ)',
    doctorTriage: 'ਡਾਕਟਰ ਟਰਾਏਜ',
    conflicts: 'ਡਾਟਾ ਵਿਵਾਦ',
    syncManager: 'ਸਿੰਕ ਪ੍ਰਬੰਧਕ',
    signOut: 'ਲਾਗ ਆਊਟ',
    online: 'ਆਨਲਾਈਨ',
    offline: 'ਆਫਲਾਈਨ',
    patientsCount: 'ਇਸ ਡਿਵਾਈਸ ਤੇ ਮਰੀਜ਼',
    pendingSync: 'ਸਿੰਕ ਹੋਣ ਵਾਲੇ ਬਦਲਾਅ',
    searchPlaceholder: 'ਨਾਮ, ਆਈਡੀ ਜਾਂ ਪਿੰਡ ਲੱਭੋ...',
    filterAll: 'ਸਾਰੀ ਸਥਿਤੀ',
    stable: 'ਸਥਿਰ (Stable)',
    followUp: 'ਦੁਬਾਰਾ ਜਾਂਚ (Follow-up)',
    urgent: 'ਜ਼ਰੂਰੀ (Urgent)',
    addPatient: 'ਨਵਾਂ ਮਰੀਜ਼ ਸ਼ਾਮਲ ਕਰੋ',
    exportCsv: 'CSV ਐਕਸਪੋਰਟ',
    fullName: 'ਪੂਰਾ ਨਾਮ',
    age: 'ਉਮਰ',
    locality: 'ਪਿੰਡ / ਇਲਾਕਾ',
    status: 'ਸਥਿਤੀ',
    actions: 'ਕਾਰਵਾਈ',
    recordVitals: 'ਵਾਈਟਲਸ ਦਰਜ ਕਰੋ',
    edit: 'ਸੋਧੋ',
    savePatient: 'ਮਰੀਜ਼ ਸੰਭਾਲੋ',
    cancel: 'ਰੱਦ ਕਰੋ',
    customColumns: 'ਵਾਧੂ ਜਾਣਕਾਰੀ ਕਾਲਮ',
    addColumn: '+ ਕਾਲਮ ਸ਼ਾਮਲ ਕਰੋ',
    duplicateDetected: 'ਇਹ ਮਰੀਜ਼ ਪਹਿਲਾਂ ਤੋਂ ਮੌਜੂਦ ਹੈ! ਦੋਹਰਾ ਇੰਦਰਾਜ ਰੋਕੋ:',
    updateExisting: 'ਪੁਰਾਣੇ ਮਰੀਜ਼ ਦਾ ਰਿਕਾਰਡ ਖੋਲ੍ਹੋ',
    registerAnyway: 'ਵੱਖਰਾ ਵਿਅਕਤੀ ਮੰਨ ਕੇ ਦਰਜ ਕਰੋ',
    outdoorMode: '☀️ ਧੁੱਪ ਮੋਡ (Sunlight)',
    darkMode: '🌙 ਡਾਰਕ ਮੋਡ',
    warmMode: '🎨 ਮੂਲ ਥੀਮ'
  },
  hi: { // Hindi (National)
    dashboard: 'फील्ड डैशबोर्ड',
    vitals: 'स्वास्थ्य लक्षण (वाइटल्स)',
    doctorTriage: 'चिकित्सक मूल्यांकन',
    conflicts: 'डेटा विसंगतियां',
    syncManager: 'सिंक प्रबंधक',
    signOut: 'साइन आउट',
    online: 'ऑनलाइन',
    offline: 'ऑफलाइन',
    patientsCount: 'इस डिवाइस पर मरीज़',
    pendingSync: 'सिंक के लिए लंबित बदलाव',
    searchPlaceholder: 'नाम, आईडी, फोन या गांव खोजें...',
    filterAll: 'सभी स्थितियां',
    stable: 'स्थिर (Stable)',
    followUp: 'पुनर्जांच (Follow-up)',
    urgent: 'अति आवश्यक (Urgent)',
    addPatient: 'मरीज़ जोड़ें',
    exportCsv: 'CSV डाउनलोड',
    fullName: 'पूरा नाम',
    age: 'उम्र',
    locality: 'क्षेत्र / गांव',
    status: 'स्थिति',
    actions: 'कार्य',
    recordVitals: 'वाइटल्स दर्ज करें',
    edit: 'संपादित करें',
    savePatient: 'मरीज़ सहेजें',
    cancel: 'रद्द करें',
    customColumns: 'कस्टम जानकारी कॉलम',
    addColumn: '+ कॉलम जोड़ें',
    duplicateDetected: 'यह मरीज़ पहले से मौजूद है! डुप्लीकेट प्रविष्टि से बचें:',
    updateExisting: 'मौजूदा मरीज़ को अपडेट करें',
    registerAnyway: 'अलग व्यक्ति के रूप में सहेजें',
    outdoorMode: '☀️ धूप मोड (High Contrast)',
    darkMode: '🌙 डार्क मोड',
    warmMode: '🎨 डिफॉल्ट थीम'
  },
  ta: { // Tamil (Tamil Nadu)
    dashboard: 'கள முகப்பு',
    vitals: 'முக்கிய அறிகுறிகள்',
    doctorTriage: 'மருத்துவர் மதிப்பீடு',
    conflicts: 'தரவு முரண்பாடுகள்',
    syncManager: 'ஒத்திசைவு மேலாளர்',
    signOut: 'வெளியேறு',
    online: 'ஆன்லைன்',
    offline: 'ஆஃப்லைன்',
    patientsCount: 'இந்த சாதனத்தில் நோயாளிகள்',
    pendingSync: 'ஒத்திசைக்க வேண்டிய மாற்றங்கள்',
    searchPlaceholder: 'பெயர், எண் அல்லது ஊர் தேடுக...',
    filterAll: 'அனைத்து நிலைகளும்',
    stable: 'நிலையானது',
    followUp: 'தொடர் கவனிப்பு',
    urgent: 'அவசரம்',
    addPatient: 'நோயாளி சேர்',
    exportCsv: 'CSV ஏற்றுமதி',
    fullName: 'முழு பெயர்',
    age: 'வயது',
    locality: 'ஊர் / பகுதி',
    status: 'நிலை',
    actions: 'செயல்கள்',
    recordVitals: 'அறிகுறிகள் பதிவு',
    edit: 'திருத்து',
    savePatient: 'சேமிக்க',
    cancel: 'ரத்து',
    customColumns: 'கூடுதல் தகவல் பத்திகள்',
    addColumn: '+ பத்தி சேர்',
    duplicateDetected: 'ஏற்கனவே இந்த நோயாளி உள்ளார்! நகல் பதிவைத் தவிர்க்கவும்:',
    updateExisting: 'தற்போதுள்ள நோயாளியைப் புதுப்பிக்கவும்',
    registerAnyway: 'வேறு நபர் எனப் பதிவு செய்',
    outdoorMode: '☀️ வெயில் பயன்முறை',
    darkMode: '🌙 இரவு பயன்முறை',
    warmMode: '🎨 இயல்பு தோற்றம்'
  },
  te: { // Telugu (Andhra / Telangana)
    dashboard: 'ఫీల్డ్ డ్యాష్‌బోర్డ్',
    vitals: 'వైటల్స్',
    doctorTriage: 'డాక్టర్ సమీక్ష',
    conflicts: 'డేటా వివాదాలు',
    syncManager: 'సింక్ మేనేజర్',
    signOut: 'సైన్ అవుట్',
    online: 'ఆన్‌లైన్',
    offline: 'ఆఫ్‌లైన్',
    patientsCount: 'ఈ పరికరంలో రోగులు',
    pendingSync: 'సింక్ కావలసిన మార్పులు',
    searchPlaceholder: 'పేరు, ఐడీ లేదా ఊరు వెతకండి...',
    filterAll: 'అన్ని స్థితులు',
    stable: 'నిలకడగా ఉంది',
    followUp: 'ఫాలో-అప్',
    urgent: 'అత్యవసరం',
    addPatient: 'రోగిని జోడించండి',
    exportCsv: 'CSV ఎగుమతి',
    fullName: 'పూర్తి పేరు',
    age: 'వయస్సు',
    locality: 'ప్రాంతం / గ్రామం',
    status: 'స్థితి',
    actions: 'చర్యలు',
    recordVitals: 'వైటల్స్ నమోదు',
    edit: 'సవరించు',
    savePatient: 'సేవ్ చేయండి',
    cancel: 'రద్దు',
    customColumns: 'అదనపు వివరాల కాలమ్స్',
    addColumn: '+ కాలమ్ జోడించండి',
    duplicateDetected: 'ఈ పేరుతో రోగి ఇప్పటికే ఉన్నారు! డూప్లికేట్ నమోదును నివారించండి:',
    updateExisting: 'ప్రస్తుత రోగి వివరాలు అప్‌డేట్ చేయండి',
    registerAnyway: 'వేరే వ్యక్తిగా నమోదు చేయండి',
    outdoorMode: '☀️ ఎండ మోడ్',
    darkMode: '🌙 డార్క్ మోడ్',
    warmMode: '🎨 సాధారణ థీమ్'
  },
  ml: { // Malayalam (Kerala)
    dashboard: 'ഫീൽഡ് ഡാഷ്‌ബോർഡ്',
    vitals: 'ശാരീരിക ലക്ഷണങ്ങൾ',
    doctorTriage: 'ഡോക്ടർ വിലയിരുത്തൽ',
    conflicts: 'ഡാറ്റ പൊരുത്തക്കേടുകൾ',
    syncManager: 'സിങ്ക് മാനേജർ',
    signOut: 'സൈൻ ഔട്ട്',
    online: 'ഓൺലൈൻ',
    offline: 'ഓഫ്‌ലൈൻ',
    patientsCount: 'ഈ ഫോണിലെ രോഗികൾ',
    pendingSync: 'സിങ്ക് ചെയ്യാനുള്ള മാറ്റങ്ങൾ',
    searchPlaceholder: 'പേര്, ഐഡി, പ്രദേശം തിരയുക...',
    filterAll: 'എല്ലാ അവസ്ഥകളും',
    stable: 'സ്ഥിരതയുള്ളത്',
    followUp: 'തുടർ പരിശോധന',
    urgent: 'അടിയന്തിരം',
    addPatient: 'രോഗിയെ ചേർക്കുക',
    exportCsv: 'CSV എക്സ്പോർട്ട്',
    fullName: 'പൂർണ്ണ നാമം',
    age: 'പ്രായം',
    locality: 'പ്രദേശം / ഗ്രാമം',
    status: 'അവസ്ഥ',
    actions: 'നടപടികൾ',
    recordVitals: 'ലക്ഷണങ്ങൾ രേഖപ്പെടുത്തുക',
    edit: 'തിരുത്തുക',
    savePatient: 'സൂക്ഷിക്കുക',
    cancel: 'റദ്ദാക്കുക',
    customColumns: 'കൂടുതൽ വിവരങ്ങൾ',
    addColumn: '+ കോളം ചേർക്കുക',
    duplicateDetected: 'ഈ രോഗി നിലവിലുണ്ട്! ഇരട്ട എൻട്രി ഒഴിവാക്കുക:',
    updateExisting: 'നിലവിലുള്ള രോഗിയെ അപ്ഡേറ്റ് ചെയ്യുക',
    registerAnyway: 'മറ്റൊരു ആളായി രജിസ്റ്റർ ചെയ്യുക',
    outdoorMode: '☀️ വെയിൽ മോഡ്',
    darkMode: '🌙 ഡാർക്ക് മോഡ്',
    warmMode: '🎨 സ്വാഭാവിക ശൈലി'
  },
  kn: { // Kannada (Karnataka)
    dashboard: 'ಫೀಲ್ಡ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    vitals: 'ಆರೋಗ್ಯ ಲಕ್ಷಣಗಳು',
    doctorTriage: 'ವೈದ್ಯರ ಪರಿಶೀಲನೆ',
    conflicts: 'ಮಾಹಿತಿ ವಿವಾದಗಳು',
    syncManager: 'ಸಿಂಕ್ ಮ್ಯಾನೇಜರ್',
    signOut: 'ಸೈನ್ ಔಟ್',
    online: 'ಆನ್‌ಲೈನ್',
    offline: 'ಆಫ್‌ಲೈನ್',
    patientsCount: 'ಈ ಸಾಧನದಲ್ಲಿರುವ ರೋಗಿಗಳು',
    pendingSync: 'ಸಿಂಕ್ ಆಗಬೇಕಿರುವ ಬದಲಾವಣೆಗಳು',
    searchPlaceholder: 'ಹೆಸರು, ಐಡಿ ಅಥವಾ ಊರು ಹುಡುಕಿ...',
    filterAll: 'ಎಲ್ಲಾ ಸ್ಥಿತಿಗಳು',
    stable: 'ಸ್ಥಿರವಾಗಿದೆ',
    followUp: 'ಮರುಪರಿಶೀಲನೆ',
    urgent: 'ತುರ್ತು',
    addPatient: 'ರೋಗಿ ಸೇರಿಸಿ',
    exportCsv: 'CSV ಎಕ್ಸ್‌ಪೋರ್ಟ್',
    fullName: 'ಪೂರ್ಣ ಹೆಸರು',
    age: 'ವಯಸ್ಸು',
    locality: 'ಪ್ರದೇಶ / ಊರು',
    status: 'ಸ್ಥಿತಿ',
    actions: 'ಕ್ರಮಗಳು',
    recordVitals: 'ಲಕ್ಷಣ ದಾಖಲಿಸಿ',
    edit: 'ತಿದ್ದಿ',
    savePatient: 'ಉಳಿಸಿ',
    cancel: 'ರದ್ದು',
    customColumns: 'ಹೆಚ್ಚುವರಿ ಮಾಹಿತಿ',
    addColumn: '+ ಕಾಲಮ್ ಸೇರಿಸಿ',
    duplicateDetected: 'ಈ ರೋಗಿ ಈಗಾಗಲೇ ಅಸ್ತಿತ್ವದಲ್ಲಿದ್ದಾರೆ! ನಕಲು ನಮೂದು ತಪ್ಪಿಸಿ:',
    updateExisting: 'ಈಗಿರುವ ರೋಗಿಯನ್ನು ನವೀಕರಿಸಿ',
    registerAnyway: 'ಬೇರೆ ವ್ಯಕ್ತಿಯಾಗಿ ನೋಂದಾಯಿಸಿ',
    outdoorMode: '☀️ ಬಿಸಿಲು ಮೋಡ್',
    darkMode: '🌙 ಡಾರ್ಕ್ ಮೋಡ್',
    warmMode: '🎨 ಸಾಮಾನ್ಯ ಥೀಮ್'
  },
  or: { // Odia (Odisha)
    dashboard: 'ଫିଲ୍ଡ ଡ୍ୟାସବୋର୍ଡ',
    vitals: 'ସ୍ୱାସ୍ଥ୍ୟ ଲକ୍ଷଣ',
    doctorTriage: 'ଡାକ୍ତର ପରୀକ୍ଷା',
    conflicts: 'ତଥ୍ୟ ବିବାଦ',
    syncManager: 'ସିଙ୍କ ମ୍ୟାନେଜର',
    signOut: 'ଲଗ ଆଉଟ',
    online: 'ଅନଲାଇନ',
    offline: 'ଅଫଲାଇନ',
    patientsCount: 'ଏହି ଡିଭାଇସରେ ଥିବା ରୋଗୀ',
    pendingSync: 'ସିଙ୍କ ହେବାକୁ ଥିବା ତଥ୍ୟ',
    searchPlaceholder: 'ନାମ, ଆଇଡି କିମ୍ବା ଗ୍ରାମ ଖୋଜନ୍ତୁ...',
    filterAll: 'ସମସ୍ତ ସ୍ଥିତି',
    stable: 'ସ୍ଥିର',
    followUp: 'ପୁନଃ ପରୀକ୍ଷା',
    urgent: 'ଜରୁରୀ',
    addPatient: 'ରୋଗୀ ଯୋଗ କରନ୍ତୁ',
    exportCsv: 'CSV ଏକ୍ସପୋର୍ଟ',
    fullName: 'ପୂରା ନାମ',
    age: 'ବୟସ',
    locality: 'ସ୍ଥାନ / ଗ୍ରାମ',
    status: 'ସ୍ଥିତି',
    actions: 'ପଦକ୍ଷେପ',
    recordVitals: 'ଲକ୍ଷଣ ଲେଖନ୍ତୁ',
    edit: 'ସଂଶୋଧନ',
    savePatient: 'ରୋଗୀ ସାଇତନ୍ତୁ',
    cancel: 'ବାତିଲ',
    customColumns: 'ଅତିରିକ୍ତ ସୂଚନା',
    addColumn: '+ କଲମ ଯୋଡନ୍ତୁ',
    duplicateDetected: 'ଏହି ନାମର ରୋଗୀ ପୂର୍ବରୁ ଅଛନ୍ତି! ନକଲ ଏଡାନ୍ତୁ:',
    updateExisting: 'ପୂର୍ବ ରୋଗୀଙ୍କୁ ଅଦ୍ୟତନ କରନ୍ତୁ',
    registerAnyway: 'ଅନ୍ୟ ବ୍ୟକ୍ତି ଭାବେ ସାଇତନ୍ତୁ',
    outdoorMode: '☀️ ଖରା ମୋଡ',
    darkMode: '🌙 ଅନ୍ଧାର ମୋଡ',
    warmMode: '🎨 ମୂଳ ଥିମ'
  },
  mr: { // Marathi (Maharashtra)
    dashboard: 'फील्ड डॅशबोर्ड',
    vitals: 'आरोग्य लक्षणे (व्हाइटल्स)',
    doctorTriage: 'डॉक्टर मूल्यमापन',
    conflicts: 'डेटा विसंगती',
    syncManager: 'सिंक व्यवस्थापक',
    signOut: 'बाहेर पडा',
    online: 'ऑनलाइन',
    offline: 'ऑफलाइन',
    patientsCount: 'या उपकरणावरील रुग्ण',
    pendingSync: 'सिंकसाठी प्रलंबित बदल',
    searchPlaceholder: 'नाव, आयडी किंवा गाव शोधा...',
    filterAll: 'सर्व स्थिती',
    stable: 'स्थिर',
    followUp: 'पुनर्तपासणी',
    urgent: 'तातडीचे',
    addPatient: 'रुग्ण जोडा',
    exportCsv: 'CSV डाउनलोड',
    fullName: 'पूर्ण नाव',
    age: 'वय',
    locality: 'परिसर / गाव',
    status: 'स्थिती',
    actions: 'क्रिया',
    recordVitals: 'व्हाइटल्स नोंदवा',
    edit: 'संपादित करा',
    savePatient: 'रुग्ण सेव्ह करा',
    cancel: 'रद्द करा',
    customColumns: 'अतिरिक्त माहिती रकाने',
    addColumn: '+ रकाना जोडा',
    duplicateDetected: 'हा रुग्ण आधीपासून अस्तित्वात आहे! डुप्लिकेट टाळा:',
    updateExisting: 'अस्तित्वात असलेला रुग्ण अपडेट करा',
    registerAnyway: 'वेगळी व्यक्ती म्हणून जतन करा',
    outdoorMode: '☀️ उन्हाळा मोड (High Contrast)',
    darkMode: '🌙 डार्क मोड',
    warmMode: '🎨 मूळ थीम'
  }
};

const LANG_STORAGE_KEY = 'setu_selected_language';

export function getSavedLanguage(): LangCode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(LANG_STORAGE_KEY) as LangCode;
      if (saved && TRANSLATIONS[saved]) return saved;
    }
  } catch { }
  return 'en';
}

export function saveLanguage(code: LangCode): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LANG_STORAGE_KEY, code);
    }
  } catch { }
}

export function t(code: LangCode): TranslationStrings {
  return TRANSLATIONS[code] || TRANSLATIONS.en;
}

export type AppTheme = 'default' | 'sunlight' | 'dark';

const THEME_STORAGE_KEY = 'setu_selected_theme';

export function getSavedTheme(): AppTheme {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as AppTheme;
      if (saved === 'default' || saved === 'sunlight' || saved === 'dark') return saved;
    }
  } catch { }
  return 'default';
}

export function saveTheme(theme: AppTheme): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch { }
}

type I18nListener = () => void;
const listeners = new Set<I18nListener>();
let currentLang: LangCode = getSavedLanguage();
let currentTheme: AppTheme = getSavedTheme();

if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', currentTheme);
}

export function useI18n() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick(t => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const changeLang = (newLang: LangCode) => {
    currentLang = newLang;
    saveLanguage(newLang);
    listeners.forEach(fn => fn());
  };

  const changeTheme = (newTheme: AppTheme) => {
    currentTheme = newTheme;
    saveTheme(newTheme);
    listeners.forEach(fn => fn());
  };

  return {
    lang: currentLang,
    setLang: changeLang,
    theme: currentTheme,
    setTheme: changeTheme,
    t: t(currentLang)
  };
}
