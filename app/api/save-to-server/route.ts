import { NextRequest, NextResponse } from 'next/server';
import { getAlbumInfo, getDownloadURL } from '@/lib/qobuz-dl-server';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const MUSIC_PATH = process.env.MUSIC_PATH || '/app/music';

function cleanSegment(str: string): string {
    return str.replace(/[/\\?:*"<>|]/g, '_').trim();
}

async function saveTrack(
    trackId: number,
    quality: string,
    artist: string,
    albumTitle: string,
    year: string,
    trackNumber: number,
    trackTotal: number,
    title: string,
    coverUrl: string | null,
    country?: string | null
) {
    const albumFolder = year ? `(${year}) ${albumTitle}` : albumTitle;
    const dirPath = path.join(MUSIC_PATH, cleanSegment(artist), cleanSegment(albumFolder));
    fs.mkdirSync(dirPath, { recursive: true });

    const url = await getDownloadURL(trackId, quality, country ? { country } : {});
    const response = await axios.get(url, { responseType: 'arraybuffer' });

    // Infer extension from URL mime hint, default flac
    const ext = url.includes('.mp3') ? 'mp3' : url.includes('.m4a') ? 'm4a' : 'flac';

    const padWidth = Math.max(String(trackTotal).length, 2);
    const padded = String(trackNumber).padStart(padWidth, '0');
    const filename = `${padded} ${cleanSegment(title)}.${ext}`;
    fs.writeFileSync(path.join(dirPath, filename), Buffer.from(response.data));

    if (coverUrl) {
        const coverPath = path.join(dirPath, 'cover.jpg');
        if (!fs.existsSync(coverPath)) {
            try {
                const coverRes = await axios.get(coverUrl, { responseType: 'arraybuffer' });
                fs.writeFileSync(coverPath, Buffer.from(coverRes.data));
            } catch {
                // cover art is optional
            }
        }
    }
}

export async function POST(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    try {
        const body = await request.json();

        if (body.type === 'album') {
            const { album_id, quality } = body;
            const album = await getAlbumInfo(album_id, country ? { country } : {});
            const artist = album.artist.name;
            const albumTitle = album.title + (album.version ? ` (${album.version})` : '');
            const year = String(new Date(album.released_at * 1000).getFullYear());
            const coverUrl = album.image?.large || null;
            const tracks: any[] = album.tracks.items;

            for (const track of tracks) {
                if (!track.streamable) continue;
                const title = track.title + (track.version ? ` (${track.version})` : '');
                await saveTrack(track.id, quality, artist, albumTitle, year, track.track_number, tracks.length, title, coverUrl, country);
            }
            return NextResponse.json({ success: true });
        }

        if (body.type === 'track') {
            const { track_id, quality, artist, album, year, track_number, track_total, title, album_image } = body;
            await saveTrack(track_id, quality, artist, album, String(year), track_number, track_total, title, album_image, country);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
