import React from 'react';
import { Sprout, Layers, ArrowRight, ArrowLeft, Calendar } from 'lucide-react';



export default function FarmDetails({ 
  mode = 'crop', // 'crop' | 'soil'
  farmData, 
  setFarmData, 
  onNext, 
  onBack 
}) {
  const crop = farmData?.crop || '';
  const variety = farmData?.variety || '';
  const stage = farmData?.stage || '';
  const plantingDate = farmData?.plantingDate || '';
  const soilType = farmData?.soilType || '';

  const updateField = (field, value) => {
    setFarmData((prev) => ({ ...prev, [field]: value }));
  };

  if (mode === 'soil') {
    return (
      <div className="flow-card premium-card animate-fadeIn">
        <div className="card-header-badge">
          <Layers size={18} className="badge-icon" />
          <span>Step 5 • Soil Details (Optional)</span>
        </div>

        <div className="name-setup-header">
          <div className="title-with-pill">
            <h2 className="step-title">Soil Details</h2>
            <span className="optional-tag-badge">Optional</span>
          </div>
          <p className="step-subtitle">
            If you know your field's soil type, select it below. You can also skip this step.
          </p>
        </div>

        <div className="field-group" style={{ marginTop: '20px' }}>
          <label className="field-label">Soil Classification</label>
          <div className="select-wrapper">
            <input 
              type="text"
              className="input-field"
              placeholder="e.g. Black soil, Red soil (Optional)"
              value={soilType}
              onChange={(e) => updateField('soilType', e.target.value)}
            />
          </div>
          <span className="field-hint">
            Leave this blank if you do not know your soil type. AgriShield will not estimate a soil test from missing information.
          </span>
        </div>

        <div className="step-actions split">
          <button type="button" className="btn-secondary-action" onClick={onBack}>
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>

          <button type="button" className="btn-primary-action" onClick={onNext}>
            <span>Continue to Water Source</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // mode === 'crop'
  return (
    <div className="flow-card premium-card animate-fadeIn">
      <div className="card-header-badge">
        <Sprout size={18} className="badge-icon" />
        <span>Step 4 • Crop Details (Optional)</span>
      </div>

      <div className="name-setup-header">
        <div className="title-with-pill">
          <h2 className="step-title">Crop Details</h2>
          <span className="optional-tag-badge">Optional</span>
        </div>
        <p className="step-subtitle">
          Add your crop information if you have planted. You can also leave this empty.
        </p>
      </div>

      <div className="form-fields-grid" style={{ marginTop: '20px' }}>
        {/* Crop Name */}
        <div className="field-group">
          <label className="field-label">Crop Name</label>
          <input 
            type="text"
            className="input-field"
            placeholder="e.g. Tomato, Cotton, Rice (Optional, leave empty if none)"
            value={crop}
            onChange={(e) => updateField('crop', e.target.value)}
          />
        </div>

        {/* Variety */}
        <div className="field-group">
          <label className="field-label">Crop Variety (Optional)</label>
          <input 
            type="text"
            className="input-field"
            placeholder="e.g. Arka Rakshak, Hybrid (Optional)"
            value={variety}
            onChange={(e) => updateField('variety', e.target.value)}
          />
        </div>

        {/* Growth Stage */}
        <div className="field-group">
          <label className="field-label">Crop Stage (Optional)</label>
          <input 
            type="text"
            className="input-field"
            placeholder="e.g. Seedling, Vegetative, Flowering, Fruiting"
            value={stage}
            onChange={(e) => updateField('stage', e.target.value)}
          />
        </div>

        {/* Planting Date */}
        <div className="field-group">
          <label className="field-label">
            <Calendar size={13} /> Sowing / Planting Date (Optional)
          </label>
          <input 
            type="date"
            className="input-field"
            value={plantingDate}
            onChange={(e) => updateField('plantingDate', e.target.value)}
          />
        </div>
      </div>

      <div className="step-actions split">
        <button type="button" className="btn-secondary-action" onClick={onBack}>
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>

        <button type="button" className="btn-primary-action" onClick={onNext}>
          <span>Continue to Soil Details</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
