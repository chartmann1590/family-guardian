export function visitRowToJson(r) {
    return {
        id: r.id,
        userId: r.userId,
        circleId: r.circleId,
        placeId: r.placeId,
        placeName: r.placeName,
        lat: r.lat,
        lng: r.lng,
        label: r.label,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMs: r.endedAt != null ? r.endedAt - r.startedAt : null,
        pointCount: r.pointCount,
    };
}

export function tripRowToJson(r) {
    return {
        id: r.id,
        userId: r.userId,
        circleId: r.circleId,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMs: r.endedAt != null ? r.endedAt - r.startedAt : null,
        mode: r.mode,
        distanceM: r.distanceM,
        maxSpeedMps: r.maxSpeedMps,
        avgSpeedMps: r.avgSpeedMps,
        startLat: r.startLat,
        startLng: r.startLng,
        endLat: r.endLat,
        endLng: r.endLng,
        startLabel: r.startLabel,
        endLabel: r.endLabel,
    };
}

export function checkinRowToJson(r) {
    return {
        id: r.id,
        userId: r.userId,
        circleId: r.circleId,
        displayName: r.displayName,
        status: r.status,
        lat: r.lat,
        lng: r.lng,
        note: r.note,
        createdAt: r.createdAt,
        photoUrl: r.photoUrl || null,
    };
}
