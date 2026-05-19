// Locale-aware unit formatting. Shared between dashboard, member detail, etc.
// Pick imperial for en-US/en-LR/en-MM (the three holdouts), metric otherwise.
(function () {
    const IMPERIAL = /-?(US|LR|MM)$/i;
    function isImperial() {
        const lang = (navigator.language || navigator.userLanguage || 'en-US').trim();
        return IMPERIAL.test(lang);
    }
    function formatSpeed(mps) {
        if (mps == null || Number.isNaN(mps)) return '—';
        return isImperial()
            ? (mps * 2.2369362921).toFixed(1) + ' mph'
            : (mps * 3.6).toFixed(1) + ' km/h';
    }
    function formatDistance(m) {
        if (m == null || Number.isNaN(m)) return '—';
        if (isImperial()) {
            const miles = m / 1609.344;
            if (miles >= 0.1) return miles.toFixed(1) + ' mi';
            return Math.round(m * 3.2808) + ' ft';
        }
        if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
        return Math.round(m) + ' m';
    }
    function formatDuration(ms) {
        if (ms == null || ms < 0) return '—';
        const sec = Math.floor(ms / 1000);
        const h = Math.floor(sec / 3600);
        const min = Math.floor((sec % 3600) / 60);
        if (h > 0) return h + 'h ' + min + 'm';
        if (min > 0) return min + 'm';
        return '<1m';
    }
    function activityIcon(activity) {
        switch (activity) {
            case 'driving': return 'directions_car';
            case 'walking': return 'directions_walk';
            case 'running': return 'directions_run';
            case 'cycling': return 'pedal_bike';
            case 'still': return 'pause_circle';
            default: return null;
        }
    }
    function activityLabel(activity) {
        switch (activity) {
            case 'driving': return 'Driving';
            case 'walking': return 'Walking';
            case 'running': return 'Running';
            case 'cycling': return 'Cycling';
            case 'still': return 'Stationary';
            default: return null;
        }
    }
    window.FgUnits = { isImperial, formatSpeed, formatDistance, formatDuration, activityIcon, activityLabel };
})();
