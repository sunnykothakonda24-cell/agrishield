import React from 'react';
import { Mountain, Check, ArrowRight, ArrowLeft, Layers } from 'lucide-react';

const landscapes = [
  {
    id: 'flat',
    name: 'FLAT',
    icon: '🌾',
    badge: 'Most Common',
    description: 'Even elevation, ideal for standard furrow, flood, and drip irrigation.'
  },
  {
    id: 'sloped',
    name: 'SLOPED',
    icon: '⛰️',
    badge: 'Gradient Flow',
    description: 'Gentle incline requiring contour bunding or controlled drip lines.'
  },
  {
    id: 'hilly',
    name: 'HILLY',
    icon: '🏔️',
    badge: 'Terraced Terrain',
    description: 'Terraced hillside beds prone to rapid runoff and elevation changes.'
  },
  {
    id: 'other',
    name: 'OTHER',
    icon: '🌄',
    badge: 'Custom',
    description: 'Irregular terrain, wetlands, or mixed agricultural topography.'
  }
];

export default function LandscapeSelector({ 
  landscape, 
  setLandscape, 
  onNext, 
  onBack 
}) {
  return (
    <div className="flow-card animate-fadeIn">
      <div className="card-header-badge">
        <Layers size={18} className="badge-icon" />
        <span>Step 3B • Land Type</span>
      </div>

      <h2 className="step-title">🌾 Land Type</h2>
      <p className="step-subtitle">What type of land is your farm on?</p>

      <div className="landscape-grid">
        {landscapes.map((item) => {
          const isSelected = (landscape?.toLowerCase() === item.id);
          return (
            <div
              key={item.id}
              className={`landscape-card ${isSelected ? 'selected' : ''}`}
              onClick={() => setLandscape(item.name)}
            >
              <div className="landscape-icon-box">
                <span className="landscape-emoji">{item.icon}</span>
                {isSelected && (
                  <div className="selection-badge">
                    <Check size={14} color="#ffffff" />
                  </div>
                )}
              </div>
              <h3 className="landscape-name">{item.name}</h3>
              <span className="landscape-tag">{item.badge}</span>
              <p className="landscape-desc">{item.description}</p>
            </div>
          );
        })}
      </div>

      <div className="step-actions split">
        <button type="button" className="btn-secondary-action" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
        <button type="button" className="btn-primary-action" onClick={onNext}>
          <span>Create Farm View</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
