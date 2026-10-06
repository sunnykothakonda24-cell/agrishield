import React from 'react';
import { BookOpen, CalendarDays, Droplet, Sprout } from 'lucide-react';
import { translate } from '../i18n';
import { useAppPreferences } from '../services/useAppPreferences';

const NOT_AVAILABLE = 'Not available';

export default function CropsInfoView({ profile, onSelectCropForChat }) {
  const { language } = useAppPreferences();
  const t = (key, values) => translate(language, key, values);
  const farm = profile?.farm || {};
  const crop = farm.cropDetails || {};
  const cropName = crop.name || farm.crop;
  const entries = [
    ['Variety', crop.variety || farm.variety],
    ['Growth Stage', crop.stage || farm.stage],
    ['Sowing Information', crop.plantingDate || farm.plantingDate],
    ['Expected Harvest', crop.harvestDate || farm.harvestDate],
    ['Soil Information', farm.soilDetails?.type || farm.soilType],
    ['Irrigation Information', crop.irrigationInformation],
    ['Fertilizer Information', crop.fertilizerInformation],
    ['Common Diseases & Pests', crop.diseaseAndPestInformation],
    ['Harvest Information', crop.harvestInformation]
  ];

  return (
    <div className="crops-info-view animate-fadeIn">
      <div className="crops-info-header">
        <div className="header-title-box">
          <Sprout size={24} color="#10b981" />
          <div>
            <h3>{t('crops.title')}</h3>
            <p>Crop information saved to your farm profile</p>
          </div>
        </div>
      </div>

      {!cropName ? (
        <div className="crop-detail-card">
          <div className="empty-icon-box"><Sprout size={28} color="#10b981" /></div>
          <h4>No crops added yet</h4>
          <p>Add your crop information from Farm Profile to receive personalized crop guidance.</p>
        </div>
      ) : (
        <div className="crop-detail-card">
          <div className="card-top-banner">
            <div>
              <span className="crop-badge-tag">Saved Farm Crop</span>
              <h4>{cropName}</h4>
            </div>
            <button
              type="button"
              className="btn-chat-about-crop"
              onClick={() => onSelectCropForChat?.(cropName)}
            >
              <span>Ask AI about my crop</span>
              <BookOpen size={16} />
            </button>
          </div>
          <div className="crop-specs-grid">
            {entries.map(([label, value], index) => (
              <div className="spec-card" key={label}>
                <span className="spec-label">
                  {index === 2 || index === 3
                    ? <CalendarDays size={14} color="#38bdf8" />
                    : index === 5
                      ? <Droplet size={14} color="#0284c7" />
                      : <Sprout size={14} color="#10b981" />}
                  {label}
                </span>
                <span className="spec-value">{value || NOT_AVAILABLE}</span>
              </div>
            ))}
          </div>
          <p className="crop-data-note">
            Only details saved in your farm profile are shown here. Ask the assistant for general guidance;
            recommendations may require more crop and field information.
          </p>
        </div>
      )}
    </div>
  );
}
