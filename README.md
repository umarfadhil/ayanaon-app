# ayanaon-app
hyperlocal social discovery platform that answers the fundamental question Indonesians ask every day

## How to Verify Live Users Feature (Local Development)

To check if the "Live Users" feature is running correctly when using the local server (`netlify dev`), follow these steps:

1.  **Start the local server:** Ensure the local Netlify development server is running by executing `netlify dev` in your terminal.
2.  **Open the application in multiple browser tabs/windows:** Open the application in several different browser tabs or even different browsers (e.g., Chrome, Firefox). Each tab/browser will simulate a unique "user."
3.  **Observe the "Live Users" count:** The "Live Users" count displayed on the application (usually in the top right corner) should increase as new tabs/browsers access the application.
4.  **Check the network requests:**
    *   Open your browser's developer tools (usually by pressing F12).
    *   Go to the "Network" tab.
    *   Filter for requests to `/api/unique-ips`. You should see these requests happening approximately every 5 seconds.
    *   Examine the responses to these requests; they should contain the updated count of unique IP addresses.
5.  **Check the backend logs (optional):** In the terminal where `netlify dev` is running, you can observe log messages from the `recordIpAddress` function (if `console.log` statements were added there) indicating when an IP address is recorded. You can also inspect your MongoDB database directly to view the `unique_ips` collection.