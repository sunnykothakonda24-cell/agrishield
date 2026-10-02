import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, Clock3, LoaderCircle, ShoppingBag } from 'lucide-react';
import { getCropSchedule, updateCropActivityStatus } from '../services/api';
import { useAppPreferences } from '../services/useAppPreferences';
import { translate } from '../i18n';

function formatScheduledDate(value, language) {
  const [year, month, day] = value.split('-').map(Number);
  const locale = language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short'
  });
}

function statusLabel(activity, today, t, language) {
  if (activity.status === 'DUE') return activity.scheduledDate === today
    ? t('cropSchedule.dueToday')
    : t('cropSchedule.dueOn', { date: formatScheduledDate(activity.scheduledDate, language) });
  if (activity.status === 'UPCOMING') return formatScheduledDate(activity.scheduledDate, language);
  if (activity.status === 'COMPLETED') return t('cropSchedule.completed');
  if (activity.status === 'NOT_YET') return t('cropSchedule.notYet');
  if (activity.status === 'SKIPPED') return t('cropSchedule.skipped');
  return activity.status;
}

export default function CropSchedule({ farm, onViewInShop }) {
  const { language } = useAppPreferences();
  const t = (key, values) => translate(language, key, values);
  const farmId = farm?._id;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const requestKey = `${farmId || 'no-farm'}:${timeZone}`;
  const [scheduleRequest, setScheduleRequest] = useState(null);
  const [updatingKey, setUpdatingKey] = useState('');

  const schedule = !farmId
    ? { configured: false, reason: 'no_farm', activities: [] }
    : scheduleRequest?.key === requestKey
      ? scheduleRequest.schedule
      : null;
  const loading = Boolean(farmId) &&
    (scheduleRequest?.key !== requestKey || scheduleRequest.loading);
  const error = scheduleRequest?.key === requestKey ? scheduleRequest.error : '';

  const loadSchedule = useCallback(async (signal) => {
    if (!farmId) return { configured: false, reason: 'no_farm', activities: [] };
    return getCropSchedule(farmId, { timeZone, signal });
  }, [farmId, timeZone]);

  const refreshSchedule = async () => {
    setScheduleRequest((previous) => ({
      key: requestKey,
      schedule: previous?.key === requestKey ? previous.schedule : null,
      loading: true,
      error: ''
    }));
    try {
      const nextSchedule = await loadSchedule();
      setScheduleRequest({ key: requestKey, schedule: nextSchedule, loading: false, error: '' });
    } catch (requestError) {
      setScheduleRequest((previous) => ({
        key: requestKey,
        schedule: previous?.key === requestKey ? previous.schedule : null,
        loading: false,
        error: requestError.message || 'Crop schedule is temporarily unavailable.'
      }));
    }
  };

  useEffect(() => {
    if (!farmId) return undefined;
    const controller = new AbortController();
    loadSchedule(controller.signal)
      .then((nextSchedule) => {
        setScheduleRequest({ key: requestKey, schedule: nextSchedule, loading: false, error: '' });
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setScheduleRequest({
            key: requestKey,
            schedule: null,
            loading: false,
            error: requestError.message || 'Crop schedule is temporarily unavailable.'
          });
        }
      });
    return () => controller.abort();
  }, [farmId, loadSchedule, requestKey]);

  const updateStatus = async (activity, status) => {
    const key = `${activity.id}:${activity.scheduledDate}`;
    setUpdatingKey(key);
    setScheduleRequest((previous) => ({
      key: requestKey,
      schedule: previous?.key === requestKey ? previous.schedule : null,
      loading: false,
      error: ''
    }));
    try {
      await updateCropActivityStatus(farmId, activity.id, {
        scheduledDate: activity.scheduledDate,
        status,
        timeZone
      });
      await refreshSchedule();
    } catch (requestError) {
      setScheduleRequest((previous) => ({
        key: requestKey,
        schedule: previous?.key === requestKey ? previous.schedule : null,
        loading: false,
        error: requestError.message || 'Activity status could not be saved.'
      }));
    } finally {
      setUpdatingKey('');
    }
  };

  const activities = schedule?.activities || [];
  const dueActivities = activities.filter((activity) =>
    ['DUE', 'COMPLETED', 'NOT_YET', 'SKIPPED'].includes(activity.status)
  );
  const upcomingActivities = activities.filter((activity) => activity.status === 'UPCOMING');

  return (
    <section className="crop-schedule" aria-labelledby="crop-schedule-heading">
      <header className="crop-schedule-header">
        <div className="crop-schedule-title">
          <span className="crop-schedule-icon"><CalendarDays size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="crop-schedule-heading">{t('cropSchedule.title')}</h2>
            <p>
              {schedule?.crop || farm?.cropDetails?.name || farm?.crop || 'No crop added yet'}
              {schedule?.cropAgeDays != null && ` · Day ${schedule.cropAgeDays}`}
              {schedule?.currentStage && ` · ${schedule.currentStage}`}
            </p>
          </div>
        </div>
        {schedule?.configured && (
          <span className="crop-schedule-advisory">{t('cropSchedule.advisory')}</span>
        )}
      </header>

      {loading ? (
        <div className="crop-schedule-loading" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
          <span>{t('cropSchedule.loading')}</span>
        </div>
      ) : error ? (
        <div className="crop-schedule-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refreshSchedule()}>{t('cropSchedule.retry')}</button>
        </div>
      ) : !schedule?.configured ? (
        <p className="crop-schedule-empty">
          {schedule?.reason === 'no_farm'
            ? t('cropSchedule.noFarm')
            : schedule?.reason === 'no_crop'
              ? t('cropSchedule.noCrop')
              : schedule?.reason === 'planting_date_missing'
                ? t('cropSchedule.addDate')
                : schedule?.reason === 'protocol_variety_mismatch'
                  ? t('cropSchedule.noVariety')
                  : schedule?.crop
                    ? t('cropSchedule.noProtocol', { crop: schedule.crop })
                    : t('cropSchedule.notConfigured')}
        </p>
      ) : schedule.reason === 'planting_date_missing' || schedule.reason === 'planting_date_in_future' ? (
        <p className="crop-schedule-empty">
          {schedule.reason === 'planting_date_missing'
            ? t('cropSchedule.addDate')
            : t('cropSchedule.futureDate')}
        </p>
      ) : (
        <div className="crop-schedule-content">
          {error && <p className="crop-schedule-error" role="alert">{error}</p>}
          {dueActivities.length > 0 && (
            <div className="crop-schedule-group">
              <h3>{t('cropSchedule.todayDue')}</h3>
              {dueActivities.map((activity) => {
                const key = `${activity.id}:${activity.scheduledDate}`;
                const canUpdate = ['DUE', 'NOT_YET'].includes(activity.status);
                return (
                  <article className="crop-activity-row" key={key}>
                    <span className={`crop-activity-status status-${activity.status.toLowerCase()}`}>
                      {activity.status === 'COMPLETED' ? <Check size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
                    </span>
                    <div className="crop-activity-copy">
                      <strong>{activity.name}</strong>
                      <span>{activity.stage || schedule.currentStage || t('cropSchedule.activity')} · {statusLabel(activity, schedule.today, t, language)}</span>
                    </div>
                    <div className="crop-activity-actions">
                      {activity.productCategory && activity.productQuery && (
                        <button
                          className="crop-shop-action"
                          type="button"
                          onClick={() => onViewInShop({
                            category: activity.productCategory,
                            crop: schedule.crop,
                            variety: schedule.variety || '',
                            stage: activity.stage || schedule.currentStage || '',
                            query: activity.productQuery
                          })}
                        >
                          <ShoppingBag size={15} aria-hidden="true" /> {t('cropSchedule.viewShop')}
                        </button>
                      )}
                      {canUpdate && (
                        <>
                          <button
                            className="crop-done-action"
                            type="button"
                            disabled={updatingKey === key}
                            onClick={() => void updateStatus(activity, 'COMPLETED')}
                          >
                            {updatingKey === key ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                            {t('cropSchedule.done')}
                          </button>
                          <button
                            className="crop-not-yet-action"
                            type="button"
                            disabled={updatingKey === key}
                            onClick={() => void updateStatus(activity, 'NOT_YET')}
                          >
                            {t('cropSchedule.notYet')}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="crop-schedule-group">
            <h3>{t('cropSchedule.upcoming')}</h3>
            {upcomingActivities.length ? (
              <ol className="crop-upcoming-timeline">
                {upcomingActivities.slice(0, 5).map((activity) => (
                  <li key={`${activity.id}:${activity.scheduledDate}`}>
                    <time dateTime={activity.scheduledDate}>Day {activity.dayAfterStart} · {formatScheduledDate(activity.scheduledDate, language)}</time>
                    <strong>{activity.name}</strong>
                    <span>{activity.stage || t('cropSchedule.scheduledActivity')}</span>
                    {activity.productCategory && activity.productQuery && (
                      <button
                        type="button"
                        onClick={() => onViewInShop({
                          category: activity.productCategory,
                          crop: schedule.crop,
                          variety: schedule.variety || '',
                          stage: activity.stage || schedule.currentStage || '',
                          query: activity.productQuery
                        })}
                      >
                        <ShoppingBag size={14} aria-hidden="true" /> {t('cropSchedule.viewShop')}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="crop-schedule-empty">
                {dueActivities.length ? t('cropSchedule.noUpcoming') : t('cropSchedule.noActivities')}
              </p>
            )}
          </div>
          <p className="crop-schedule-footnote">{t('cropSchedule.footnote')}</p>
        </div>
      )}
    </section>
  );
}
