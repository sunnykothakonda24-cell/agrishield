import React, { useState } from 'react';
import { 
  Droplets, 
  Waves, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  CircleDot, 
  CloudRain, 
  CircleHelp,
  Container
} from 'lucide-react';

const WATER_SOURCE_OPTIONS = [
  { id: 'Borewell', name: 'Borewell', desc: 'Groundwater from a borewell', typeTag: 'Groundwater', Icon: Droplets },
  { id: 'Well', name: 'Open Well', desc: 'Water drawn from an open well', typeTag: 'Groundwater', Icon: CircleDot },
  { id: 'Canal', name: 'Canal', desc: 'Water supplied through an irrigation canal', typeTag: 'Surface Water', Icon: Waves },
  { id: 'River', name: 'River', desc: 'Water taken from a nearby river', typeTag: 'Surface Water', Icon: Waves },
  { id: 'Rainwater', name: 'Farm Pond', desc: 'Water collected and stored on the farm', typeTag: 'Rainwater / Storage', Icon: CloudRain },
  { id: 'Tank', name: 'Storage Tank', desc: 'Water stored in a farm tank', typeTag: 'Storage', Icon: Container },
  { id: 'Other', name: 'Other', desc: 'Another water source', typeTag: 'Custom', Icon: CircleHelp }
];

export default function WaterDetails({ 
  waterData, 
  setWaterData, 
  onNext, 
  onBack 
}) {
  // Current selection (Requirements 17, 18, 19, 20)
  const currentSource = typeof waterData === 'string' ? waterData : (waterData?.source || waterData?.otherSource || '');
  const [selectedId, setSelectedId] = useState(
    WATER_SOURCE_OPTIONS.some(o => o.id === currentSource) ? currentSource : (currentSource ? 'Other' : '')
  );
  const [otherText, setOtherText] = useState(
    WATER_SOURCE_OPTIONS.some(o => o.id === currentSource) ? '' : currentSource
  );

  const handleSelect = (id) => {
    setSelectedId(id);
    if (id === 'Other') {
      const val = otherText.trim();
      setWaterData(val ? { source: val, otherSource: val } : null);
    } else {
      setWaterData({ source: id, otherSource: id });
    }
  };

  const handleOtherTextChange = (e) => {
    const val = e.target.value;
    setOtherText(val);
    setWaterData(val.trim() ? { source: val.trim(), otherSource: val.trim() } : null);
  };

  const handleSkip = () => {
    setSelectedId('');
    setWaterData(null);
  };

  return (
    <section className="flow-card premium-card farm-step-card water-step-card animate-fadeIn" aria-labelledby="water-step-title">
      <div className="farm-step-heading">
        <div className="farm-step-heading-copy">
          <span className="farm-step-count">Step 6 of 7</span>
          <h2 className="step-title" id="water-step-title">Water Source</h2>
          <p className="farm-step-lead">How does water reach your farm?</p>
          <p className="step-subtitle">Choose the main water source you use for irrigation.</p>
        </div>
        <span className="farm-step-optional">Optional</span>
      </div>

      <div className="farm-progress-heading">
        <span>Farm setup</span>
        <span>Step 6 of 7</span>
      </div>
      <div className="farm-progress-segments" role="img" aria-label="Farm setup, step 6 of 7">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className={index < 6 ? 'complete' : ''} />
        ))}
      </div>

      <div className="water-source-cards-grid" role="radiogroup" aria-label="Choose your main water source">
        {WATER_SOURCE_OPTIONS.map((item) => {
          const isSelected = selectedId === item.id;
          const Icon = item.Icon;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              key={item.id}
              className={`water-card-item ${isSelected ? 'active-selection' : ''}`}
              onClick={() => handleSelect(item.id)}
            >
              <div className="card-icon-container">
                <Icon size={23} aria-hidden="true" />
                <span className={`selection-check-indicator ${isSelected ? 'checked' : ''}`}>
                  {isSelected && <Check size={14} strokeWidth={3} />}
                </span>
              </div>

              <div className="card-text-container">
                <span className="water-source-type-tag">{item.typeTag}</span>
                <h4 className="water-source-title">{item.name}</h4>
                <p className="water-source-desc">{item.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {selectedId === 'Other' && (
        <div className="custom-water-field animate-slideUp">
          <label className="field-label" htmlFor="custom-water-input">
            <span>Enter your water source</span>
          </label>
          <input 
            id="custom-water-input"
            type="text"
            className="input-field"
            placeholder="e.g. Tanker water, Mountain stream, Lift irrigation"
            value={otherText}
            onChange={handleOtherTextChange}
            autoFocus
          />
        </div>
      )}

      <button type="button" className={`water-skip-option ${!selectedId ? 'selected' : ''}`} onClick={handleSkip}>
        <span className="water-skip-check">{!selectedId && <Check size={15} aria-hidden="true" />}</span>
        <span>
          <strong>Skip for now</strong>
          <small>I'll add my water source later</small>
        </span>
        {!selectedId && <span className="water-skip-status">Selected</span>}
      </button>

      <div className="step-actions split water-step-actions">
        <button type="button" className="btn-secondary-action" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>

        <button 
          type="button" 
          className="btn-primary-action" 
          onClick={onNext}
        >
          <span>Continue to Review</span>
          <ArrowRight size={18} />
        </button>
      </div>
      <p className="water-next-step-note">Next: review your farm details</p>
    </section>
  );
}
