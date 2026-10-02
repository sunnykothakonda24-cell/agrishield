import React from 'react';

export default function DigitalFarmView({
  profile = {},
  weather = null,
  weatherEffect = 'unknown',
  onPinClick
}) {
  const weatherLabel = weather?.condition || weather?.description || 'Weather data unavailable';
  const isRain = weatherEffect === 'rain';
  const isSunny = weatherEffect === 'sun';
  const isNight = weatherEffect === 'night';
  const areaAcres = profile.farm?.boundary?.areaAcres;
  const crop = profile.farm?.crop;

  return (
    <div className="digital-farm-container">
      <div className="digital-farm-viewport">
        <svg
          viewBox="0 0 920 540"
          className="digital-farm-svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Farm boundary visualization with current weather when available"
        >
          <defs>
            <linearGradient id="farmSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isNight ? '#1e293b' : isRain ? '#94a3b8' : isSunny ? '#bae6fd' : '#dbe3e8'} />
              <stop offset="100%" stopColor={isNight ? '#334155' : isRain ? '#cbd5e1' : '#f1f5f9'} />
            </linearGradient>
            <linearGradient id="farmSoil" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#80613f" />
              <stop offset="100%" stopColor="#5d4037" />
            </linearGradient>
          </defs>

          <rect width="920" height="540" rx="24" fill="url(#farmSky)" />
          {isSunny && <circle cx="110" cy="90" r="34" fill="#facc15" opacity="0.9" />}
          {weatherEffect !== 'unknown' && (
            <g fill={isRain ? '#64748b' : '#ffffff'} opacity="0.85">
              <ellipse cx="330" cy="85" rx="60" ry="22" />
              <ellipse cx="370" cy="75" rx="38" ry="28" />
              <ellipse cx="405" cy="86" rx="44" ry="19" />
            </g>
          )}
          {isRain && <path d="M310 116v42m45-42v42m45-42v42" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />}

          <g transform="translate(460 310)">
            <polygon points="0,-165 390,30 0,225 -390,30" fill="#000000" opacity="0.12" transform="translate(0 30)" />
            <polygon points="-390,30 0,225 0,265 -390,70" fill="#5d4037" />
            <polygon points="0,225 390,30 390,70 0,265" fill="#4e342e" />
            <polygon points="0,-165 390,30 0,225 -390,30" fill="url(#farmSoil)" stroke="#10b981" strokeWidth="4" />
            {[-130, -80, -30, 20].map((offset) => (
              <path
                key={offset}
                d={`M${offset - 85},${offset - 20} L${offset + 155},${offset + 100}`}
                stroke="#a18865"
                strokeWidth="12"
                strokeLinecap="round"
                opacity="0.85"
              />
            ))}
            <path d="M-390 30 0 225 390 30" fill="none" stroke="#d6d3d1" strokeWidth="1.5" opacity="0.7" />
          </g>

          <g
            className="farm-pin-group"
            transform="translate(460 205)"
            role="button"
            tabIndex="0"
            onClick={() => onPinClick?.('weather')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onPinClick?.('weather');
            }}
          >
            <rect x="-150" y="-19" width="300" height="38" rx="19" fill="#ffffff" stroke="#0284c7" strokeWidth="1.5" />
            <text textAnchor="middle" y="5" fontSize="13" fontWeight="700" fill="#075985">Weather: {weatherLabel}</text>
          </g>
        </svg>

        <div className="digital-farm-badge-overlay">
          <div className="farm-crop-indicator">
            <span className="crop-title font-semibold">{crop ? `${crop} Farm Twin` : 'Farm Twin'}</span>
            <span className="boundary-badge">Saved farm visualization</span>
          </div>
          {areaAcres && <div className="farm-acres-pill"><span>{areaAcres} Acres</span></div>}
        </div>
      </div>
    </div>
  );
}
