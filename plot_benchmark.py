"""
This script was authored by Gemini 3 Pro, a large language model trained by Google.
Date: 2026-01-03
"""

import json
import matplotlib.pyplot as plt
import argparse
import os
import sys
from collections import defaultdict

def load_data(filepath):
    if not os.path.exists(filepath):
        print(f"Error: File '{filepath}' not found.")
        sys.exit(1)
        
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"Error: Failed to decode JSON from '{filepath}'.")
        sys.exit(1)

def process_data(data):
    grouped_data = defaultdict(list)

    for entry in data:
        v = entry['problemSize']['vehicles']
        o = entry['problemSize']['orders']
        time = entry['execTime']
        
        grouped_data[(v, o)].append(time)

    sorted_keys = sorted(grouped_data.keys(), key=lambda k: (k[0] + k[1], k[0]))
    
    x_labels = []
    y_values = []

    for key in sorted_keys:
        v, o = key
        times = grouped_data[key]
        avg_time = sum(times) / len(times)
        
        x_labels.append(f"{v}_{o}")
        y_values.append(avg_time)

    return x_labels, y_values

def plot_benchmark(x_labels, y_values, algorithm_name, use_log_scale=False):
    plt.figure(figsize=(14, 8))

    bars = plt.bar(x_labels, y_values, color='skyblue', edgecolor='navy', alpha=0.7)

    plt.xlabel('Problem size (vehicles_orders)', fontsize=12, fontweight='bold')
    plt.ylabel('Avg execution time (ms)', fontsize=12, fontweight='bold')
    plt.title(f'Benchmark results: {algorithm_name}\nAverage execution time per problem size', fontsize=14)
    
    plt.xticks(rotation=45, ha='right', fontsize=9)
    
    plt.grid(axis='y', linestyle='--', alpha=0.5)

    if use_log_scale:
        plt.yscale('log')
        plt.ylabel('Avg Execution Time (ms) - Log Scale', fontsize=12, fontweight='bold')

    for bar in bars:
        height = bar.get_height()
        label_y = height if not use_log_scale else height * 1.1
        
        label_text = f'{height/1000:.2f}s' if height > 1000 else f'{height:.0f}'
        
        plt.text(bar.get_x() + bar.get_width() / 2.0, label_y, 
                 label_text, ha='center', va='bottom', fontsize=8, rotation=90)

    plt.tight_layout()
    
    print("Displaying plot...")
    plt.show()

def main():
    parser = argparse.ArgumentParser(description='Plot VRP Benchmark Results')
    parser.add_argument('file', nargs='?', default='benchmark-results-brute-force.json', 
                        help='Path to the benchmark results JSON file')
    parser.add_argument('--log', action='store_true', help='Use logarithmic scale for Y axis')
    
    args = parser.parse_args()

    print(f"Loading data from {args.file}...")
    data = load_data(args.file)
    
    algo_name = args.file.replace('benchmark-results-', '').replace('.json', '')
    
    x, y = process_data(data)
    
    if not x:
        print("No data found in file.")
        sys.exit(0)

    plot_benchmark(x, y, algo_name, args.log)

if __name__ == "__main__":
    main()
