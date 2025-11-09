import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import Konva from 'konva';
import 'konva/canvas-backend';
import { createCanvas } from 'canvas';

import { ProblemJSON } from './src/types/problem-json';

const WIDTH = 800;
const HEIGHT = 600;
const PADDING = 50;
const problemsDir = './src/problems';

const drawIllustration = (data: ProblemJSON, filename: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const canvas = createCanvas(WIDTH, HEIGHT);

        const stage = new Konva.Stage({
            width: WIDTH,
            height: HEIGHT,
            container: 'dummy-container',
            _context: canvas.getContext('2d'),
            _canvas: canvas,
        });

        const layer = new Konva.Layer();
        stage.add(layer);

        // --- Drawing Logic ---
        // You'll need to adjust the scaling and positioning based on your coordinate ranges
        // For simplicity, let's assume coordinates are small and scale them up
        const scaleX = (WIDTH - 2 * PADDING) / 10; // Max X from your example is 10
        const scaleY = (HEIGHT - 2 * PADDING) / 10; // Max Y from your example is 8 (order o3 delivery)

        const transformX = (x: number) => PADDING + x * scaleX;
        const transformY = (y: number) => HEIGHT - PADDING - y * scaleY; // Invert Y for canvas coordinates

        // Draw Vehicles
        data.vehicles.forEach(vehicle => {
            const x = transformX(vehicle.startLocation.x);
            const y = transformY(vehicle.startLocation.y);

            layer.add(
                new Konva.Circle({
                    x: x,
                    y: y,
                    radius: 10,
                    fill: 'blue',
                    stroke: 'black',
                    strokeWidth: 1,
                }),
            );

            layer.add(
                new Konva.Text({
                    x: x + 15,
                    y: y - 5,
                    text: `${vehicle.id} (Cap: ${vehicle.capacity})`,
                    fontSize: 12,
                    fill: 'black',
                }),
            );
        });

        // Draw Orders
        data.orders.forEach(order => {
            const pickupX = transformX(order.pickupLocation.x);
            const pickupY = transformY(order.pickupLocation.y);
            const deliveryX = transformX(order.deliveryLocation.x);
            const deliveryY = transformY(order.deliveryLocation.y);

            // Pickup location
            layer.add(
                new Konva.Circle({
                    x: pickupX,
                    y: pickupY,
                    radius: 7,
                    fill: 'green',
                    stroke: 'darkgreen',
                    strokeWidth: 1,
                }),
            );
            layer.add(
                new Konva.Text({
                    x: pickupX - 10,
                    y: pickupY - 20,
                    text: `P-${order.id}`,
                    fontSize: 10,
                    fill: 'darkgreen',
                }),
            );

            // Delivery location
            layer.add(
                new Konva.Circle({
                    x: deliveryX,
                    y: deliveryY,
                    radius: 7,
                    fill: 'red',
                    stroke: 'darkred',
                    strokeWidth: 1,
                }),
            );
            layer.add(
                new Konva.Text({
                    x: deliveryX + 10,
                    y: deliveryY - 20,
                    text: `D-${order.id}`,
                    fontSize: 10,
                    fill: 'darkred',
                }),
            );

            // Line connecting pickup to delivery
            layer.add(
                new Konva.Line({
                    points: [pickupX, pickupY, deliveryX, deliveryY],
                    stroke: 'gray',
                    strokeWidth: 1,
                    dash: [5, 5],
                }),
            );

            // Order ID in the middle of the path
            layer.add(
                new Konva.Text({
                    x: (pickupX + deliveryX) / 2,
                    y: (pickupY + deliveryY) / 2,
                    text: order.id,
                    fontSize: 10,
                    fill: 'black',
                    rotation: (Math.atan2(deliveryY - pickupY, deliveryX - pickupX) * 180) / Math.PI,
                    offsetX: -10, // Adjust to center
                    offsetY: 10,
                }),
            );
        });

        // Add a title
        layer.add(
            new Konva.Text({
                x: PADDING,
                y: PADDING / 2,
                text: `Vehicle Routing Problem: ${filename.replace('.json', '')}`,
                fontSize: 20,
                fontFamily: 'Arial',
                fill: 'black',
            }),
        );

        layer.draw(); // Important: draw the layer

        // Save the canvas to a PNG file
        const outPath = path.join(problemsDir, `${filename.replace('.json', '')}.png`);
        const outStream = createWriteStream(outPath);
        const pngStream = canvas.createPNGStream();

        pngStream.on('data', chunk => outStream.write(chunk));
        pngStream.on('end', () => {
            console.log(`Generated ${outPath}`);
            resolve();
        });
        pngStream.on('error', err => {
            reject(err);
        });
    });
};

const main = async () => {
    const problemFiles = (await fs.readdir(problemsDir)).filter(file => file.endsWith('.json'));

    for (const file of problemFiles) {
        try {
            const content = await fs.readFile(path.join(problemsDir, file), 'utf-8');
            const problem: ProblemJSON = JSON.parse(content);
            await drawIllustration(problem, file);
        } catch (error) {
            console.error(`Failed to process ${file}`);
            console.error(error);
        }
    }
};

main();
