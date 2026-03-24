import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MUSIC_PATH = process.env.MUSIC_PATH || '/app/music';

function cleanSegment(str: string): string {
    return str.replace(/[/\\?:*"<>|]/g, '_').trim();
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const artist = formData.get('artist') as string;
        const album = formData.get('album') as string;
        const year = formData.get('year') as string;
        const trackNumber = parseInt(formData.get('trackNumber') as string);
        const trackTotal = parseInt(formData.get('trackTotal') as string);
        const title = formData.get('title') as string;
        const extension = formData.get('extension') as string;
        const audioFile = formData.get('audio') as File;
        const coverFile = formData.get('cover') as File | null;

        const albumFolder = year ? `(${year}) ${album}` : album;
        const dirPath = path.join(MUSIC_PATH, cleanSegment(artist), cleanSegment(albumFolder));
        fs.mkdirSync(dirPath, { recursive: true });

        const padWidth = Math.max(String(trackTotal).length, 2);
        const padded = String(trackNumber).padStart(padWidth, '0');
        const filename = `${padded} ${cleanSegment(title)}.${extension}`;
        fs.writeFileSync(path.join(dirPath, filename), Buffer.from(await audioFile.arrayBuffer()));

        if (coverFile) {
            const coverPath = path.join(dirPath, 'cover.jpg');
            if (!fs.existsSync(coverPath)) {
                fs.writeFileSync(coverPath, Buffer.from(await coverFile.arrayBuffer()));
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
