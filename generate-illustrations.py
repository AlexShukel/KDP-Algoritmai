import json
import os
import matplotlib.pyplot as plt
import matplotlib.patches as patches

# --- Configuration ---
INPUT_DIR = './src/problems'
OUTPUT_DIR = INPUT_DIR
WIDTH = 12  # inches for matplotlib figure
HEIGHT = 9   # inches
DPI = 100    # dots per inch, determines image resolution

# --- Ensure output directory exists ---
os.makedirs(OUTPUT_DIR, exist_ok=True)

def draw_illustration(data: dict, filename: str):
    """
    Generates a Matplotlib illustration for the given problem data.

    Args:
        data (dict): The parsed JSON data for a single problem instance.
        filename (str): The original JSON filename (e.g., 'problem1.json').
    """
    fig, ax = plt.subplots(figsize=(WIDTH, HEIGHT), dpi=DPI)

    # --- Determine Plot Limits (adjust based on your expected coordinate range) ---
    all_x = []
    all_y = []

    # Collect all x, y coordinates to set appropriate plot limits
    for vehicle in data.get('vehicles', []):
        start_loc = vehicle.get('startLocation')
        if start_loc:
            all_x.append(start_loc['x'])
            all_y.append(start_loc['y'])

    for order in data.get('orders', []):
        pickup_loc = order.get('pickupLocation')
        delivery_loc = order.get('deliveryLocation')
        if pickup_loc:
            all_x.append(pickup_loc['x'])
            all_y.append(pickup_loc['y'])
        if delivery_loc:
            all_x.append(delivery_loc['x'])
            all_y.append(delivery_loc['y'])

    # Add a small buffer around the min/max coordinates
    min_x = min(all_x) - 1 if all_x else 0
    max_x = max(all_x) + 1 if all_x else 10
    min_y = min(all_y) - 1 if all_y else 0
    max_y = max(all_y) + 1 if all_y else 10

    ax.set_xlim(min_x, max_x)
    ax.set_ylim(min_y, max_y)
    ax.set_aspect('equal', adjustable='box') # Maintain aspect ratio

    # --- Drawing Logic ---

    # Draw Vehicles
    for vehicle in data.get('vehicles', []):
        start_loc = vehicle['startLocation']
        x, y = start_loc['x'], start_loc['y']
        ax.plot(x, y, 's', color='blue', markersize=10, label=f'Vehicle {vehicle["id"]}') # 's' for square
        ax.annotate(f'{vehicle["id"]} (Cap:{vehicle["capacity"]})', (x, y),
                    textcoords="offset points", xytext=(5,-10), ha='left', fontsize=8, color='blue')


    # Draw Orders
    for order in data.get('orders', []):
        pickup_loc = order['pickupLocation']
        delivery_loc = order['deliveryLocation']
        pickup_x, pickup_y = pickup_loc['x'], pickup_loc['y']
        delivery_x, delivery_y = delivery_loc['x'], delivery_loc['y']

        # Pickup location
        ax.plot(pickup_x, pickup_y, '^', color='green', markersize=8, label=f'Order {order["id"]} Pickup') # '^' for triangle up
        ax.annotate(f'P-{order["id"]}', (pickup_x, pickup_y),
                    textcoords="offset points", xytext=(-5,10), ha='right', fontsize=7, color='darkgreen')

        # Delivery location
        ax.plot(delivery_x, delivery_y, 'v', color='red', markersize=8, label=f'Order {order["id"]} Delivery') # 'v' for triangle down
        ax.annotate(f'D-{order["id"]}', (delivery_x, delivery_y),
                    textcoords="offset points", xytext=(5,10), ha='left', fontsize=7, color='darkred')

        # Line connecting pickup to delivery
        ax.plot([pickup_x, delivery_x], [pickup_y, delivery_y], ':', color='gray', linewidth=1)
        # ax.text((pickup_x + delivery_x) / 2, (pickup_y + delivery_y) / 2,
        #         order['id'], color='black', fontsize=8, ha='center', va='center',
        #         bbox=dict(facecolor='white', alpha=0.7, edgecolor='none', boxstyle='round,pad=0.2'))

    # --- Labels and Title ---
    ax.set_xlabel("X Coordinate")
    ax.set_ylabel("Y Coordinate")
    ax.set_title(f"Vehicle Routing Problem with Pickups and Deliveries: {filename.replace('.json', '')}", fontsize=14)
    ax.grid(True, linestyle='--', alpha=0.6)

    # --- Legend (optional, can get cluttered) ---
    # To avoid duplicate labels in legend, you might collect unique labels
    # For now, let's just make sure to place it well if enabled
    # ax.legend(loc='lower right', fontsize=8) # Uncomment if you want a legend

    # --- Save Figure ---
    output_filepath = os.path.join(OUTPUT_DIR, f"{filename.replace('.json', '')}.png")
    plt.tight_layout() # Adjust layout to prevent labels from overlapping
    plt.savefig(output_filepath)
    plt.close(fig) # Close the figure to free memory

    print(f"Generated {output_filepath}")

def main():
    """
    Reads JSON files from INPUT_DIR and generates illustrations for each.
    """
    if not os.path.exists(INPUT_DIR):
        print(f"Error: Input directory '{INPUT_DIR}' not found. Please create it and place your JSON files there.")
        return

    json_files = [f for f in os.listdir(INPUT_DIR) if f.endswith('.json')]

    if not json_files:
        print(f"No JSON files found in '{INPUT_DIR}'.")
        return

    for json_file in json_files:
        file_path = os.path.join(INPUT_DIR, json_file)
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            draw_illustration(data, json_file)
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON from {json_file}: {e}")
        except KeyError as e:
            print(f"Missing expected key in {json_file}: {e}. Check JSON structure.")
        except Exception as e:
            print(f"An unexpected error occurred while processing {json_file}: {e}")

if __name__ == "__main__":
    main()
