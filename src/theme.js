const artworkCache = new Map();

// Change the background image to the current soundscape image
export async function updateBackgroundImage(track, controls) {
    const artwork = await loadArtwork(track.image);
    document.body.style.backgroundImage = `url(${artwork.url})`;

    updateColors(artwork.bitmap, controls);

    return artwork.url;
}

// Get the primary and secondary colors from the current soundscape image.
function updateColors(image, controls) {
    const color = getAverageColor(image);

    const primaryColorString = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.6)`;
    const contrastColor = getContrastColor(color);
    const secondaryColorString = `rgba(${contrastColor[0]}, ${contrastColor[1]}, ${contrastColor[2]}, 0.6)`;

    controls.playPauseButton.style.backgroundColor = secondaryColorString;
    controls.playPauseButton.style.color = primaryColorString;

    controls.previousButton.style.backgroundColor = primaryColorString;
    controls.previousButton.style.color = secondaryColorString;

    controls.nextButton.style.backgroundColor = primaryColorString;
    controls.nextButton.style.color = secondaryColorString;

    controls.title.style.color = secondaryColorString;
}

function getAverageColor(image) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const sampleSize = 40;

    canvas.width = sampleSize;
    canvas.height = sampleSize;
    context.drawImage(image, 0, 0, sampleSize, sampleSize);

    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (let index = 0; index < pixels.length; index += 4) {
        red += pixels[index];
        green += pixels[index + 1];
        blue += pixels[index + 2];
        count += 1;
    }

    return [
        Math.round(red / count),
        Math.round(green / count),
        Math.round(blue / count),
    ];
}

async function loadArtwork(url) {
    if (artworkCache.has(url)) {
        return artworkCache.get(url);
    }

    const artworkPromise = fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load artwork: ${url}`);
            }

            return response.blob();
        })
        .then(async blob => {
            const bitmap = await createImageBitmap(blob);
            const dataUrl = await blobToDataUrl(blob);

            return {
                bitmap,
                url: dataUrl,
            };
        });

    artworkCache.set(url, artworkPromise);

    return artworkPromise;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result));
        reader.addEventListener("error", error => reject(error));
        reader.readAsDataURL(blob);
    });
}

// Get contrast color based on the given background color
function getContrastColor(color) {
    // Calculate the relative luminance of the color using the sRGB color space
    const r = color[0] / 255;
    const g = color[1] / 255;
    const b = color[2] / 255;
    const luminance = (r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)) * 0.2126
        + (g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)) * 0.7152
        + (b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)) * 0.0722;
    // Calculate the contrast color based on the luminance
    return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
}
