import { NextRequest, NextResponse } from 'next/server';
import { getAlbumInfo, getDownloadURL } from '@/lib/qobuz-dl-server';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import axios from 'axios';

const MUSIC_PATH = process.env.MUSIC_PATH || '/app/music';

function cleanSegment(str: string): string {
    return str.replace(/[/\\?:*"<>|]/g, '_').trim();
}

interface TrackMeta {
    trackId: number;
    quality: string;
    artist: string;
    albumTitle: string;
    year: string;
    trackNumber: number;
    trackTotal: number;
    discNumber?: number;
    discTotal?: number;
    title: string;
    coverUrl: string | null;
    genre?: string;
    label?: string;
    isrc?: string;
    composer?: string;
    copyright?: string;
    country?: string | null;
}

async function saveTrack(meta: TrackMeta) {
    const {
        trackId, quality, artist, albumTitle, year,
        trackNumber, trackTotal, discNumber, discTotal,
        title, coverUrl, genre, label, isrc, composer, copyright, country
    } = meta;

    const albumFolder = year ? `(${year}) ${albumTitle}` : albumTitle;
    const dirPath = path.join(MUSIC_PATH, cleanSegment(artist), cleanSegment(albumFolder));
    fs.mkdirSync(dirPath, { recursive: true });

    const url = await getDownloadURL(trackId, quality, country ? { country } : {});
    const response = await axios.get(url, { responseType: 'arraybuffer' });

    const ext = url.includes('.mp3') ? 'mp3' : url.includes('.m4a') ? 'm4a' : 'flac';
    const padWidth = Math.max(String(trackTotal).length, 2);
    const padded = String(trackNumber).padStart(padWidth, '0');
    const filename = `${padded} ${cleanSegment(title)}.${ext}`;
    const trackPath = path.join(dirPath, filename);
    const tmpPath = trackPath + '.tmp';

    // Fetch cover art
    let coverBuffer: Buffer | null = null;
    if (coverUrl) {
        try {
            const coverRes = await axios.get(coverUrl, { responseType: 'arraybuffer' });
            coverBuffer = Buffer.from(coverRes.data);
        } catch { /* optional */ }
    }

    // Skip if already downloaded
    if (fs.existsSync(trackPath)) return;

    fs.writeFileSync(tmpPath, Buffer.from(response.data));

    // Build ffmpeg metadata args
    const meta_args: string[] = [
        '-metadata', `title=${title}`,
        '-metadata', `artist=${artist}`,
        '-metadata', `album_artist=${artist}`,
        '-metadata', `album=${albumTitle}`,
        '-metadata', `date=${year}`,
        '-metadata', `tracknumber=${trackNumber}/${trackTotal}`,
    ];
    if (discNumber)  meta_args.push('-metadata', `disc=${discNumber}${discTotal ? '/' + discTotal : ''}`);
    if (genre)       meta_args.push('-metadata', `genre=${genre}`);
    if (label)       meta_args.push('-metadata', `publisher=${label}`);
    if (isrc)        meta_args.push('-metadata', `ISRC=${isrc}`);
    if (composer)    meta_args.push('-metadata', `composer=${composer}`);
    if (copyright)   meta_args.push('-metadata', `copyright=${copyright}`);

    const ffmpegArgs = ['-i', tmpPath];

    // Embed cover art as attached picture
    let coverTmpPath: string | null = null;
    if (coverBuffer) {
        coverTmpPath = tmpPath + '.cover.jpg';
        fs.writeFileSync(coverTmpPath, coverBuffer);
        ffmpegArgs.push('-i', coverTmpPath);
        ffmpegArgs.push('-map', '0', '-map', '1');
        ffmpegArgs.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    }

    ffmpegArgs.push('-c', 'copy', ...meta_args, '-y', trackPath);

    try {
        execFileSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' });
    } finally {
        fs.unlinkSync(tmpPath);
        if (coverTmpPath) fs.unlinkSync(coverTmpPath);
    }

    // Write cover.jpg alongside
    if (coverBuffer) {
        const coverPath = path.join(dirPath, 'cover.jpg');
        if (!fs.existsSync(coverPath)) fs.writeFileSync(coverPath, coverBuffer);
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
            const genre = album.genre?.name;
            const label = album.label?.name;
            const copyright = album.copyright;
            const tracks: any[] = album.tracks.items;
            const discTotal = tracks.reduce((max: number, t: any) => Math.max(max, t.media_number || 1), 1);

            for (const track of tracks) {
                if (!track.streamable) continue;
                const title = track.title + (track.version ? ` (${track.version})` : '');
                await saveTrack({
                    trackId: track.id,
                    quality,
                    artist,
                    albumTitle,
                    year,
                    trackNumber: track.track_number,
                    trackTotal: tracks.length,
                    discNumber: track.media_number,
                    discTotal,
                    title,
                    coverUrl,
                    genre,
                    label,
                    isrc: track.isrc,
                    composer: track.composer?.name,
                    copyright,
                    country
                });
            }
            return NextResponse.json({ success: true });
        }

        if (body.type === 'track') {
            const { track_id, quality, artist, album, year, track_number, track_total,
                    disc_number, title, album_image, genre, label, isrc, composer, copyright } = body;
            await saveTrack({
                trackId: track_id,
                quality,
                artist,
                albumTitle: album,
                year: String(year),
                trackNumber: track_number,
                trackTotal: track_total,
                discNumber: disc_number,
                title,
                coverUrl: album_image,
                genre,
                label,
                isrc,
                composer,
                copyright,
                country
            });
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
