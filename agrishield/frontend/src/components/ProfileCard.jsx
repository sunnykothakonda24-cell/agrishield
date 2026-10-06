import React, { useState } from 'react';
import { 
  User, 
  Phone, 
  ArrowRight, 
  AlertCircle
} from 'lucide-react';

export default function ProfileCard({ 
  farmerName = '', 
  setFarmerName, 
  mobile = '', 
  setMobile,
  onNext 
}) {
  const [nameInput, setNameInput] = useState(farmerName || '');
  const [mobileInput, setMobileInput] = useState(mobile || '');
  const [errorMsg, setErrorMsg] = useState('');

  const isValidName = nameInput.trim().length >= 2;

  const handleContinue = (e) => {
    e?.preventDefault();
    if (!isValidName) {
      setErrorMsg('Please enter your full name to proceed.');
      return;
    }
    setErrorMsg('');
    setFarmerName(nameInput.trim());
    if (setMobile && mobileInput.trim()) {
      setMobile(mobileInput.trim());
    }
    onNext();
  };

  return (
    <div className="flow-card premium-card animate-fadeIn">
      {/* Step Badge */}
      <div className="card-header-badge">
        <User size={18} className="badge-icon" />
        <span>Step 1 • Farmer Identification</span>
      </div>

      {/* Required Name Entry Heading & Subheading */}
      <div className="name-setup-header">
        <h2 className="step-title">Let's set up your farm</h2>
        <p className="step-subtitle">First, tell us your name.</p>
      </div>

      <form onSubmit={handleContinue} className="name-entry-form">
        <div className="field-group">
          <label className="field-label" htmlFor="farmer-name-input">
            <span>Your Name</span>
          </label>
          <div className="input-with-icon">
            <User size={18} className="input-leading-icon" />
            <input 
              id="farmer-name-input"
              type="text" 
              className="input-field with-icon" 
              value={nameInput} 
              onChange={(e) => {
                setNameInput(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="Enter your name"
              autoFocus
              autoComplete="name"
            />
          </div>
          {errorMsg && (
            <div className="alert-message error animate-fadeIn">
              <AlertCircle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Optional Mobile Number */}
        <div className="field-group">
          <label className="field-label" htmlFor="farmer-mobile-input">
            <span>Mobile Number (Optional)</span>
          </label>
          <div className="input-with-icon">
            <Phone size={18} className="input-leading-icon" />
            <input 
              id="farmer-mobile-input"
              type="tel" 
              className="input-field with-icon" 
              value={mobileInput} 
              onChange={(e) => {
                setMobileInput(e.target.value);
                setMobile?.(e.target.value);
              }}
              placeholder="Enter your mobile number"
              autoComplete="tel"
            />
          </div>
        </div>

        {/* Continue Button */}
        <div className="step-actions single">
          <button 
            type="submit" 
            className="btn-primary-action large" 
            disabled={!isValidName}
          >
            <span>Continue</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
