"""
This script was authored by Gemini 3 Pro, a large language model trained by Google.
Date: 2026-01-03
"""

import json
import matplotlib.pyplot as plt
import glob
import os
import sys

DATA_DIR = './data'

def get_latest_file(prefix):
    """Finds the most recently modified file matching the pattern in DATA_DIR."""
    search_pattern = os.path.join(DATA_DIR, f'{prefix}_*.json')
    files = glob.glob(search_pattern)
    
    if not files:
        return None
        
    return max(files, key=os.path.getmtime)

def load_data(filepath):
    """Loads JSON data from a specific file."""
    print(f"Loading data from: {filepath}")
    with open(filepath, 'r') as f:
        return json.load(f)

def main():
    orders_file = get_latest_file('orders')
    vehicles_file = get_latest_file('vehicles')

    if not orders_file or not vehicles_file:
        print(f"Error: Could not find orders or vehicles json files in {DATA_DIR}")
        print("Please run the 'generate-data.ts' script first.")
        sys.exit(1)

    orders_data = load_data(orders_file)
    vehicles_data = load_data(vehicles_file)

    order_lons = [o['pickupLocation']['longitude'] for o in orders_data]
    order_lats = [o['pickupLocation']['latitude'] for o in orders_data]

    vehicle_lons = [v['startLocation']['longitude'] for v in vehicles_data]
    vehicle_lats = [v['startLocation']['latitude'] for v in vehicles_data]

    plt.figure(figsize=(12, 10))
    
    plt.scatter(
        vehicle_lons, 
        vehicle_lats, 
        c='blue', 
        s=5, 
        alpha=0.3, 
        label='Vehicles (200km Radius)',
        edgecolors='none'
    )

    plt.scatter(
        order_lons, 
        order_lats, 
        c='red', 
        s=20, 
        alpha=0.8, 
        marker='x',
        label='Order Pickups (Centers)'
    )

    plt.title(f'Vehicle & Order Distribution\nOrders: {len(orders_data)}, Vehicles: {len(vehicles_data)}')
    plt.xlabel('Longitude')
    plt.ylabel('Latitude')
    plt.legend()
    plt.grid(True, linestyle='--', alpha=0.5)
    
    plt.axis('equal')

    print("Displaying plot...")
    plt.show()

if __name__ == "__main__":
    main()
