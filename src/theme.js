// Change the background image to the current soundscape image
export async function updateBackgroundImage(track, controls) {
    // Load the image and set it as the background once loaded
    const image = await loadImage(track.image);
    document.body.style.backgroundImage = `url(${image.src})`;

    await getColors(track, controls);
}

// Get the primary and secondary colors from the current soundscape image using color-thief
// then set the play/pause button background color and text color to the primary color
async function getColors(track, controls) {
    const colorThief = new ColorThief();
    const image = await loadImage(track.image);

    const color = colorThief.getColor(image);

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

// Load an image from a given url
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener("load", () => resolve(image));
        image.addEventListener("error", error => reject(error));
        image.src = url;
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
