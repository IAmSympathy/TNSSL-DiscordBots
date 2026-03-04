/**
 * Nexa - Gestion des filtres audio via lavalink-client FilterManager
 */

import {EQList, type Player} from "lavalink-client";

export interface FilterDef {
    id: string;
    label: string;
    emoji: string;
    description: string;
}

export const FILTERS: FilterDef[] = [
    {id: "nightcore", label: "Nightcore", emoji: "🌸", description: "Pitch + vitesse élevés"},
    {id: "vaporwave", label: "Vaporwave", emoji: "🌊", description: "Pitch + vitesse ralentis"},
    {id: "karaoke", label: "Karaoke", emoji: "🎤", description: "Suppression des voix"},
    {id: "rotation", label: "8D Audio", emoji: "🎧", description: "Rotation panoramique"},
    {id: "tremolo", label: "Tremolo", emoji: "〰️", description: "Oscillation du volume"},
    {id: "vibrato", label: "Vibrato", emoji: "🎻", description: "Oscillation du pitch"},
    {id: "lowpass", label: "Low Pass", emoji: "🔉", description: "Filtre passe-bas (doux)"},
    {id: "bassboost", label: "Bass Boost", emoji: "🔊", description: "Boost des basses"},
    {id: "pop", label: "Pop", emoji: "🎵", description: "Equalizer Pop"},
    {id: "rock", label: "Rock", emoji: "🎸", description: "Equalizer Rock"},
    {id: "electronic", label: "Electronic", emoji: "🎛️", description: "Equalizer Electronic"},
    {id: "gaming", label: "Gaming", emoji: "🎮", description: "Equalizer Gaming"},
];

/** Retourne les filtres actuellement actifs sous forme d'ensemble d'ids */
export function getActiveFilters(player: Player): Set<string> {
    const active = new Set<string>();
    const f = (player.filterManager as any).filters ?? {};
    if (f.nightcore) active.add("nightcore");
    if (f.vaporwave) active.add("vaporwave");
    if (f.karaoke) active.add("karaoke");
    if (f.rotation) active.add("rotation");
    if (f.tremolo) active.add("tremolo");
    if (f.vibrato) active.add("vibrato");
    if (f.lowPass) active.add("lowpass");
    // Détecter quel EQ preset est actif via le nom du preset
    const preset = (player.filterManager as any).equalizerPreset as string | undefined;
    if (preset) {
        const presetMap: Record<string, string> = {
            BassboostHigh: "bassboost",
            Pop: "pop",
            Rock: "rock",
            Electronic: "electronic",
            Gaming: "gaming",
        };
        const id = presetMap[preset];
        if (id) active.add(id);
        else active.add("_eq");
    } else {
        const eq = f.equalizer ?? [];
        if (eq.length > 0) active.add("_eq");
    }
    return active;
}

/** Synchronise les filtres du player — un seul filtre actif à la fois */
export async function applyFilterSet(player: Player, selectedIds: string[]): Promise<void> {
    const fm = player.filterManager;

    // Désactiver tous les filtres actifs
    await fm.resetFilters();

    // Activer le filtre sélectionné (s'il y en a un)
    const filterId = selectedIds[0] ?? null;
    if (!filterId) return;

    switch (filterId) {
        case "nightcore":
            await fm.toggleNightcore();
            break;
        case "vaporwave":
            await fm.toggleVaporwave();
            break;
        case "karaoke":
            await fm.toggleKaraoke();
            break;
        case "rotation":
            await fm.toggleRotation();
            break;
        case "tremolo":
            await fm.toggleTremolo();
            break;
        case "vibrato":
            await fm.toggleVibrato();
            break;
        case "lowpass":
            await fm.toggleLowPass();
            break;
        case "bassboost":
            await fm.setEQ(EQList.BassboostHigh);
            break;
        case "pop":
            await fm.setEQPreset("Pop");
            break;
        case "rock":
            await fm.setEQPreset("Rock");
            break;
        case "electronic":
            await fm.setEQPreset("Electronic");
            break;
        case "gaming":
            await fm.setEQPreset("Gaming");
            break;
    }
}



