import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Info,
  LockKeyhole,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  Phone,
  Search,
  Send,
  Sprout,
  CloudRain,
  Rotate3d,
  ShieldCheck,
  Upload,
  X
} from 'lucide-react';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';
import {
  getSupportAccountStatus,
  getSupportContact,
  getSupportFaqs,
  submitSupportFeedback,
  submitSupportTicket
} from '../services/api';

const SUPPORT_CARDS = [
  {
    id: 'ai',
    title: 'AgriShield Support',
    description: 'Get help with your farm, weather, crops, or general questions.',
    Icon: Bot,
    keywords: 'chat voice microphone image analysis assistant telugu hindi english general'
  },
  {
    id: 'account',
    title: 'Account Status',
    description: 'View your verified account and registered mobile.',
    Icon: ShieldCheck,
    keywords: 'user id email mobile password verified security account'
  },
  {
    id: 'permissions',
    title: 'App Permissions',
    description: 'Review browser access used by location, voice, image, and notification features.',
    Icon: ShieldCheck,
    keywords: 'location notifications camera microphone voice image permissions browser'
  },
  {
    id: 'contact',
    title: 'Contact Us',
    description: 'Reach support, report an issue, or send feedback.',
    Icon: Phone,
    keywords: 'contact phone email issue report feedback support'
  }
];

const INFORMATION_CARDS = [
  {
    id: 'crops',
    title: 'Crops Info',
    description: 'View crop details saved in your farm profile.',
    Icon: Sprout,
    keywords: 'crops crop details growth stage sowing irrigation fertilizer diseases pests harvest'
  },
  {
    id: 'weather',
    title: 'Weather',
    description: 'Check current weather for your saved farm location.',
    Icon: CloudRain,
    keywords: 'weather forecast temperature rain rainfall humidity wind location'
  },
  {
    id: 'farmtwin',
    title: 'Farm Twin',
    description: 'Open the farm visualization built from your saved boundary.',
    Icon: Rotate3d,
    keywords: 'farm twin boundary area 3d water farm weather status'
  },
  {
    id: 'farmdata',
    title: 'Farm Data & Location',
    description: 'Review your saved farm location, boundary, crop, and water details.',
    Icon: MapPin,
    keywords: 'farm data location boundary coordinates crop planting water source profile edit'
  },
  {
    id: 'about',
    title: 'About AgriShield',
    description: 'Learn how farm weather, AI guidance, and Farm Twin work together.',
    Icon: Info,
    keywords: 'about information version privacy how it works farm twin'
  }
];

const ISSUE_TYPES = [
  'Account',
  'Farm Setup',
  'Satellite Map',
  'AI Assistant',
  'Voice',
  'Image Analysis',
  'Notifications',
  'Other'
];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

const PERMISSION_DEFINITIONS = [
  { id: 'location', name: 'Location', detail: 'Used when you choose GPS for farm location and location-based features.', Icon: MapPin },
  { id: 'notifications', name: 'Notifications', detail: 'May be used for important account and service information.', Icon: Bell },
  { id: 'microphone', name: 'Microphone', detail: 'Microphone access is required for voice questions in AgriShield.', Icon: Mic },
  { id: 'camera', name: 'Camera', detail: 'Camera access may be required when capturing crop images for AI analysis.', Icon: Camera },
];

function maskPhone(phone) {
  if (!phone) return 'Not available';
  const normalized = String(phone);
  if (normalized.length < 7) return 'Registered';
  return `${normalized.slice(0, 3)}${'•'.repeat(Math.max(0, normalized.length - 6))}${normalized.slice(-3)}`;
}

function StatusBadge({ status }) {
  const labels = {
    unavailable: 'Not available',
    granted: 'Allowed',
    denied: 'Denied',
    prompt: 'Not requested',
    default: 'Not requested',
    managed: 'Managed by your device'
  };
  const tone = status === 'granted'
    ? 'success'
    : status === 'prompt' || status === 'default' || status === 'managed'
      ? 'warning'
      : 'neutral';
  return <span className={`help-status-badge ${tone}`}>{labels[status] || 'Not available'}</span>;
}

function DetailHeader({ title, onBack }) {
  return (
    <div className="help-detail-header">
      <button type="button" className="help-back-button" onClick={onBack}>
        <ArrowLeft size={17} /> Back to Help & Support
      </button>
      <h2>{title}</h2>
    </div>
  );
}

function LoadError({ message, onRetry }) {
  return (
    <div className="help-inline-state error" role="alert">
      <p>{message || 'Unable to load this information right now.'}</p>
      <button type="button" className="help-secondary-button" onClick={onRetry}>Retry</button>
    </div>
  );
}

function FaqList({ faqs, query }) {
  const [expandedId, setExpandedId] = useState(null);
  const filteredFaqs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return faqs;
    return faqs.filter((faq) =>
      `${faq.category} ${faq.question} ${faq.answer}`.toLocaleLowerCase().includes(normalized)
    );
  }, [faqs, query]);

  if (!filteredFaqs.length) {
    return <p className="help-empty-state">No help articles matched your search.</p>;
  }
  return (
    <div className="help-faq-list">
      {filteredFaqs.map((faq) => (
        <div className={`help-faq-item ${expandedId === faq.id ? 'expanded' : ''}`} key={faq.id}>
          <button
            type="button"
            className="help-faq-question"
            aria-expanded={expandedId === faq.id}
            onClick={() => setExpandedId(expandedId === faq.id ? null : faq.id)}
          >
            <span>{faq.question}</span>
            <ChevronDown size={18} />
          </button>
          {expandedId === faq.id && <p className="help-faq-answer">{faq.answer}</p>}
        </div>
      ))}
    </div>
  );
}

export default function ExpertHelpView({ onOpenAssistant, onOpenPage, onOpenFarmSetup }) {
  const { language } = useAppPreferences();
  const t = (key, values) => translate(language, key, values);
  const [section, setSection] = useState(null);
  const [query, setQuery] = useState('');
  const [contact, setContact] = useState(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState('');
  const [faqs, setFaqs] = useState([]);
  const [faqsLoading, setFaqsLoading] = useState(true);
  const [faqsError, setFaqsError] = useState('');
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [permissions, setPermissions] = useState(() =>
    Object.fromEntries(PERMISSION_DEFINITIONS.map(({ id }) => [id, 'unavailable']))
  );
  const [permissionMessage, setPermissionMessage] = useState('');
  const [permissionBusy, setPermissionBusy] = useState('');
  const [issueType, setIssueType] = useState('Other');
  const [priority, setPriority] = useState('Normal');
  const [issueDescription, setIssueDescription] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [ticketState, setTicketState] = useState({ loading: false, error: '', success: '' });
  const [rating, setRating] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackState, setFeedbackState] = useState({ loading: false, error: '', success: '' });

  const loadContact = async () => {
    setContactLoading(true);
    setContactError('');
    try {
      const result = await getSupportContact();
      setContact(result.contact);
    } catch (error) {
      setContactError(error.message);
    } finally {
      setContactLoading(false);
    }
  };

  const loadFaqs = async () => {
    setFaqsLoading(true);
    setFaqsError('');
    try {
      const result = await getSupportFaqs();
      setFaqs(result.faqs);
    } catch (error) {
      setFaqsError(error.message);
    } finally {
      setFaqsLoading(false);
    }
  };

  const loadAccount = async () => {
    setAccountLoading(true);
    setAccountError('');
    try {
      const result = await getSupportAccountStatus();
      setAccount(result.account);
    } catch (error) {
      setAccountError(error.message);
    } finally {
      setAccountLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadInitialHelp = async () => {
      const results = await Promise.allSettled([getSupportContact(), getSupportFaqs()]);
      if (!active) return;
      const [contactResult, faqResult] = results;
      if (contactResult.status === 'fulfilled') setContact(contactResult.value.contact);
      else setContactError(contactResult.reason.message);
      if (faqResult.status === 'fulfilled') setFaqs(faqResult.value.faqs);
      else setFaqsError(faqResult.reason.message);
      setContactLoading(false);
      setFaqsLoading(false);
    };
    void loadInitialHelp();
    const readInitialPermissions = async () => {
      const next = {};
      if (typeof Notification !== 'undefined') {
        next.notifications = Notification.permission;
      }
      const permissionNames = ['location', 'microphone', 'camera'];
      if (navigator.permissions?.query) {
        await Promise.all(permissionNames.map(async (name) => {
          try {
            const permissionName = name === 'location' ? 'geolocation' : name;
            const result = await navigator.permissions.query({ name: permissionName });
            next[name] = result.state;
            result.addEventListener?.('change', () => {
              setPermissions((current) => ({ ...current, [name]: result.state }));
            });
          } catch {
            next[name] = name === 'location' && navigator.geolocation ? 'prompt' : 'unavailable';
          }
        }));
      } else {
        next.location = navigator.geolocation ? 'prompt' : 'unavailable';
        next.microphone = navigator.mediaDevices?.getUserMedia ? 'prompt' : 'unavailable';
        next.camera = navigator.mediaDevices?.getUserMedia ? 'prompt' : 'unavailable';
      }
      if (active) setPermissions((current) => ({ ...current, ...next }));
    };
    void readInitialPermissions();
    return () => { active = false; };
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchCards = (cards) => cards.filter((card) => {
    if (!normalizedQuery) return true;
    const matchingFaq = faqs.some((faq) =>
      `${faq.category} ${faq.question} ${faq.answer}`.toLocaleLowerCase().includes(normalizedQuery) &&
      (faq.category === card.title || faq.category === card.id || faq.category.toLocaleLowerCase().includes(card.title.toLocaleLowerCase().split(' ')[0]))
    );
    return `${card.title} ${card.description} ${card.keywords}`.toLocaleLowerCase().includes(normalizedQuery) || matchingFaq;
  });
  const quickCards = searchCards(SUPPORT_CARDS);
  const informationCards = searchCards(INFORMATION_CARDS);
  const matchingFaqs = faqs.filter((faq) =>
    `${faq.category} ${faq.question} ${faq.answer}`.toLocaleLowerCase().includes(normalizedQuery)
  );
  const hasSearchResults = quickCards.length > 0 || informationCards.length > 0 || matchingFaqs.length > 0;

  const openSection = (id) => {
    setQuery('');
    if (id === 'account') void loadAccount();
    setSection(id);
  };

  const openCard = (id) => {
    if (['crops', 'weather', 'farmtwin'].includes(id)) {
      setQuery('');
      onOpenPage?.(id);
      return;
    }
    openSection(id);
  };

  const requestPermission = async (id) => {
    setPermissionMessage('');
    setPermissionBusy(id);
    try {
      if (id === 'location') {
        if (!navigator.geolocation) throw new Error('Location is unavailable in this browser.');
        const result = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 });
        });
        setPermissions((current) => ({ ...current, location: 'granted' }));
        setPermissionMessage(`Location access works. Current coordinates: ${result.coords.latitude.toFixed(5)}, ${result.coords.longitude.toFixed(5)}.`);
      } else if (id === 'microphone' || id === 'camera') {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(`${id === 'microphone' ? 'Microphone' : 'Camera'} access is unavailable in this browser.`);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: id === 'microphone',
          video: id === 'camera'
        });
        stream.getTracks().forEach((track) => track.stop());
        setPermissions((current) => ({ ...current, [id]: 'granted' }));
        setPermissionMessage(`${id === 'microphone' ? 'Microphone' : 'Camera'} test completed. The device stream was stopped.`);
      }
    } catch (error) {
      const denied = error.name === 'NotAllowedError' || error.code === 1;
      if (denied) setPermissions((current) => ({ ...current, [id]: 'denied' }));
      setPermissionMessage(denied
        ? `${id === 'location' ? 'Location' : id === 'microphone' ? 'Microphone' : 'Camera'} access was denied. Allow it in your browser settings to use this feature.`
        : error.message || 'The permission check could not be completed.');
    } finally {
      setPermissionBusy('');
    }
  };

  const handleTicketSubmit = async (event) => {
    event.preventDefault();
    setTicketState({ loading: true, error: '', success: '' });
    const formData = new FormData();
    formData.append('issueType', issueType);
    formData.append('priority', priority);
    formData.append('description', issueDescription);
    if (screenshot) formData.append('screenshot', screenshot, screenshot.name);
    try {
      const result = await submitSupportTicket(formData);
      setTicketState({ loading: false, error: '', success: result.message });
      setIssueDescription('');
      setScreenshot(null);
    } catch (error) {
      setTicketState({ loading: false, error: error.message, success: '' });
    }
  };

  const handleFeedbackSubmit = async (event) => {
    event.preventDefault();
    setFeedbackState({ loading: true, error: '', success: '' });
    try {
      const result = await submitSupportFeedback({ rating, message: feedback });
      setFeedbackState({ loading: false, error: '', success: result.message });
      setFeedback('');
      setRating('');
    } catch (error) {
      setFeedbackState({ loading: false, error: error.message, success: '' });
    }
  };

  const retrySelectedSection = () => {
    if (section === 'account') void loadAccount();
    if (section === 'contact') void loadContact();
    if (section === 'ai') void loadFaqs();
  };

  const renderContent = () => {
    if (!section) return null;

    if (section === 'ai') {
      return (
        <section className="help-detail-panel">
          <DetailHeader title="AgriShield Support" onBack={() => setSection(null)} />
          <p className="help-lead">Get help with your account, farm, weather, crops, or the AI assistant.</p>
          <button type="button" className="help-primary-button" onClick={onOpenAssistant}>
            <Bot size={18} /> Open AI Assistant <ArrowRight size={16} />
          </button>
          <div className="help-support-shortcuts">
            {[
              ['Voice Support', 'Voice conversations require microphone access and a configured speech service.', Mic],
              ['Chat Support', 'Ask farming questions or have a normal conversation in English, Telugu, or Hindi.', MessageCircle],
              ['Image Analysis', 'Attach a crop image and ask the assistant to describe visible observations.', Camera],
            ].map(([title, description, Icon]) => (
              <article className="help-feature-row" key={title}>
                <Icon size={19} />
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
          <div className="help-section-heading"><CircleHelp size={18} /><h3>Frequently Asked Questions</h3></div>
          {faqsError
            ? <LoadError message={faqsError} onRetry={retrySelectedSection} />
            : faqsLoading
              ? <p className="help-loading-state">Loading help articles...</p>
              : <FaqList faqs={faqs} query={query} />}
        </section>
      );
    }

    if (section === 'permissions') {
      return (
        <section className="help-detail-panel">
          <DetailHeader title="App Permissions" onBack={() => setSection(null)} />
          <p className="help-lead">Permission status is read from this browser. Location, microphone, and camera are only requested after you choose a test.</p>
          <div className="help-permission-list">
            {PERMISSION_DEFINITIONS.map(({ id, name, detail, Icon }) => (
              <div className="help-permission-row" key={id}>
                <span className="help-permission-icon"><Icon size={18} /></span>
                <span className="help-permission-copy"><strong>{name}</strong><small>{detail}</small></span>
                <StatusBadge status={permissions[id]} />
                {['location', 'microphone', 'camera'].includes(id) &&
                  <button
                    type="button"
                    className="help-secondary-button"
                    disabled={permissionBusy === id || permissions[id] === 'unavailable'}
                    onClick={() => void requestPermission(id)}
                  >
                    {permissionBusy === id
                      ? 'Checking...'
                      : id === 'location'
                        ? 'Enable Location'
                        : id === 'microphone'
                          ? 'Test Microphone'
                          : 'Test Camera'}
                  </button>}
              </div>
            ))}
          </div>
          {permissionMessage && <p className="help-permission-message" role="status">{permissionMessage}</p>}
        </section>
      );
    }

    if (section === 'account') {
      return (
        <section className="help-detail-panel">
          <DetailHeader title="Account Status" onBack={() => setSection(null)} />
          {accountError
            ? <LoadError message={accountError} onRetry={retrySelectedSection} />
            : accountLoading
              ? <p className="help-loading-state">Loading account status...</p>
              : account
                ? <>
                  <div className="help-account-status"><CheckCircle2 size={19} /><span>Account Status</span><strong>{account.status === 'active' ? 'Active' : 'Not available'}</strong></div>
                  <dl className="help-definition-list">
                    <div><dt>Registered mobile</dt><dd>{maskPhone(account.mobile)}</dd></div>
                    <div><dt>User ID</dt><dd className="help-mono-value">{account.userId || 'Not available'}</dd></div>
                    <div><dt>Verification</dt><dd>{account.verified === true ? 'Verified' : account.verified === false ? 'Not verified' : 'Not available'}</dd></div>
                  </dl>
                  <div className="help-security-panel">
                    <LockKeyhole size={20} />
                    <div><h3>Security Information</h3>
                      <ul>
                        <li>Authenticated using secure Firebase Email and Password.</li>
                        <li>Support account details require an authenticated session.</li>
                        <li>Farm data is associated with the signed-in account.</li>
                        <li>Never share your account password or credentials with anyone.</li>
                      </ul>
                    </div>
                  </div>
                </>
                : <p className="help-empty-state">Account information is not available.</p>}
        </section>
      );
    }

    if (section === 'farmdata') {
      return (
        <section className="help-detail-panel">
          <DetailHeader title="Farm Data & Location" onBack={() => setSection(null)} />
          <p className="help-lead">Your saved farm location, boundary, crop, and water details are managed in Farm Setup. Only information you provide is saved to your account.</p>
          <button type="button" className="help-primary-button" onClick={onOpenFarmSetup}>
            <MapPin size={18} /> Review Farm Setup <ArrowRight size={16} />
          </button>
        </section>
      );
    }

    if (section === 'about') {
      return (
        <section className="help-detail-panel">
          <DetailHeader title="About AgriShield" onBack={() => setSection(null)} />
          <h3 className="help-content-title">What is AgriShield?</h3>
          <p className="help-lead">AgriShield brings farm location, available weather information, AI assistance, and a Farm Twin together to provide farmer-friendly guidance.</p>
          <h3 className="help-content-title">How it works</h3>
          <div className="help-flow-diagram" aria-label="Available farm weather and saved farm details provide context for farmer advisory">
            {[
              ['Weather Service', 'Current weather when available'],
              ['AgriShield', 'Farm location and weather context'],
              ['Agriculture Knowledge', 'Context-aware assistance'],
              ['Farmer Advisory', 'Clear guidance and next steps']
            ].map(([title, description], index) => (
              <React.Fragment key={title}>
                <div className="help-flow-step"><span>{String(index + 1).padStart(2, '0')}</span><strong>{title}</strong><small>{description}</small></div>
                {index < 3 && <ArrowRight className="help-flow-arrow" size={17} />}
              </React.Fragment>
            ))}
          </div>
          <div className="help-about-grid">
            <article><h3>AI Advisory</h3><p>Ask general or agricultural questions, discuss crops and irrigation, ask about weather, or share an image. The assistant can converse in English, Telugu, and Hindi when its provider is configured.</p></article>
            <article><h3>Weather Context</h3><p>Weather conditions are shown when weather data is available; unavailable information is clearly identified rather than estimated.</p></article>
            <article><h3>Farm Twin</h3><p>The farm visualization uses saved boundaries and available environmental information. It indicates when data is unavailable rather than presenting invented live readings.</p></article>
            <article><h3>Farm Information</h3><p>Farm location and boundary are set by the farmer. Crop and soil information remain optional and are not assumed.</p></article>
            <article><h3>Version Information</h3><p>{import.meta.env.VITE_APP_VERSION || 'Not available'}</p></article>
            <article><h3>Privacy & Security</h3><p>Account support details are requested through the authenticated backend session. Never share your password or private account credentials.</p></article>
          </div>
        </section>
      );
    }

    if (section === 'contact' || section === 'report' || section === 'feedback') {
      return (
        <section className="help-detail-panel">
          <DetailHeader
            title={section === 'contact' ? 'Contact AgriShield Support' : section === 'report' ? 'Report an Issue' : 'Send Feedback'}
            onBack={() => setSection(section === 'report' || section === 'feedback' ? 'contact' : null)}
          />
          {section === 'contact' && <p className="help-lead">Need assistance? Contact AgriShield Support.</p>}
          {contactError
            ? <LoadError message={contactError} onRetry={retrySelectedSection} />
            : contactLoading
              ? <p className="help-loading-state">Loading support information...</p>
              : section === 'contact' && !contact?.available
                ? <p className="help-empty-state">Support contact information is currently unavailable.</p>
                : null}
          {section === 'contact' && contact?.available && !contactLoading && (
            <div className="help-contact-grid">
              {contact.phone && <article><Phone size={20} /><h3>Support Phone</h3><p>{contact.phone}</p><a className="help-primary-button" href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>Call Support</a></article>}
              {contact.email && <article><Mail size={20} /><h3>Support Email</h3><p>{contact.email}</p><a className="help-primary-button" href={`mailto:${contact.email}`}>Email Support</a></article>}
            </div>
          )}
          {section === 'contact' && (
            <div className="help-contact-actions">
              <button type="button" className="help-secondary-button" onClick={() => setSection('report')}><CircleHelp size={17} /> Report an Issue</button>
              <button type="button" className="help-secondary-button" onClick={() => setSection('feedback')}><MessageCircle size={17} /> Send Feedback</button>
            </div>
          )}
          {section === 'report' && (
            <form className="help-form" onSubmit={handleTicketSubmit}>
              <label>Issue type<select value={issueType} onChange={(event) => setIssueType(event.target.value)}>{ISSUE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}>{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="help-form-full">Description<textarea value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} minLength={5} maxLength={4000} required rows={5} placeholder="Describe what happened and what you expected." /></label>
              <label className="help-file-picker help-form-full"><Upload size={17} /> Optional screenshot or image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                if (file && file.size > 5 * 1024 * 1024) {
                  setTicketState({ loading: false, error: 'Screenshot must be 5 MB or smaller.', success: '' });
                  event.target.value = '';
                  setScreenshot(null);
                } else {
                  setTicketState({ loading: false, error: '', success: '' });
                  setScreenshot(file);
                }
              }} />{screenshot && <span>{screenshot.name}</span>}</label>
              {ticketState.error && <p className="help-form-error help-form-full" role="alert">{ticketState.error}</p>}
              {ticketState.success && <p className="help-form-success help-form-full" role="status">{ticketState.success}</p>}
              <button type="submit" className="help-primary-button help-form-full" disabled={ticketState.loading}>
                <Send size={17} /> {ticketState.loading ? 'Submitting...' : 'Submit Issue'}
              </button>
            </form>
          )}
          {section === 'feedback' && (
            <form className="help-form" onSubmit={handleFeedbackSubmit}>
              <label>Rating (optional)<select value={rating} onChange={(event) => setRating(event.target.value)}><option value="">No rating</option>{[5, 4, 3, 2, 1].map((value) => <option value={value} key={value}>{value} out of 5</option>)}</select></label>
              <label className="help-form-full">Feedback<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} minLength={2} maxLength={4000} required rows={5} placeholder="Tell us what worked well or what we could improve." /></label>
              {feedbackState.error && <p className="help-form-error help-form-full" role="alert">{feedbackState.error}</p>}
              {feedbackState.success && <p className="help-form-success help-form-full" role="status">{feedbackState.success}</p>}
              <button type="submit" className="help-primary-button help-form-full" disabled={feedbackState.loading}>
                <Send size={17} /> {feedbackState.loading ? 'Sending...' : 'Send Feedback'}
              </button>
            </form>
          )}
        </section>
      );
    }
    return null;
  };

  if (section) {
    return <div className="help-support-page">{renderContent()}</div>;
  }

  return (
    <div className="help-support-page">
      <header className="help-page-heading">
        <div className="help-heading-icon"><CircleHelp size={22} /></div>
        <div><h2>{t('help.title')}</h2><p>Find answers and get help with your account and farm tools.</p></div>
      </header>

      <label className="help-search-box">
        <Search size={19} />
        <span className="sr-only">Search help topics</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search help topics..." />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear help search"><X size={17} /></button>}
      </label>

      {normalizedQuery && !hasSearchResults && <p className="help-empty-state">No help articles matched your search.</p>}
      {quickCards.length > 0 && (
        <section className="help-card-section">
          <div className="help-section-heading"><h3>Support</h3></div>
          <div className="help-category-grid support">
            {quickCards.map(({ id, title, description, Icon }) => (
              <button type="button" className="help-category-card" key={id} onClick={() => openCard(id)}>
                <span className="help-card-icon"><Icon size={21} /></span>
                <span className="help-card-content"><strong>{title}</strong><small>{description}</small></span>
                <ArrowRight size={18} className="help-card-arrow" />
              </button>
            ))}
          </div>
        </section>
      )}

      {informationCards.length > 0 && (
        <section className="help-card-section">
          <div className="help-section-heading"><h3>AgriShield Information</h3></div>
          <div className="help-category-grid information">
            {informationCards.map(({ id, title, description, Icon }) => (
              <button type="button" className="help-category-card" key={id} onClick={() => openCard(id)}>
                <span className="help-card-icon"><Icon size={21} /></span>
                <span className="help-card-content"><strong>{title}</strong><small>{description}</small></span>
                <ArrowRight size={18} className="help-card-arrow" />
              </button>
            ))}
          </div>
        </section>
      )}

      {normalizedQuery && matchingFaqs.length > 0 && (
        <section className="help-search-faqs">
          <div className="help-section-heading"><CircleHelp size={18} /><h3>Matching Help Articles</h3></div>
          {faqsLoading
            ? <p className="help-loading-state">Loading help articles...</p>
            : faqsError
              ? <LoadError message={faqsError} onRetry={() => void loadFaqs()} />
              : <FaqList faqs={matchingFaqs} query={query} />}
        </section>
      )}

      {faqsError && !normalizedQuery && <LoadError message={faqsError} onRetry={() => void loadFaqs()} />}
      <p className="help-page-footnote"><Clock3 size={14} /> Account details are shown only when returned by the backend.</p>
    </div>
  );
}
