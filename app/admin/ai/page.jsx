"use client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
// import { useGemini } from "@/utils/aiModel";
import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown"; // Make sure you import ReactMarkdown

function ChatComponent() {
  const [messages, setMessage] = useState([]);
  const [loading, setLoading] = useState(false); // State for loading indicator

  const messagesEndRef = useRef(null); // Create a ref for the last message

  // Load messages from localStorage when the component mounts
  useEffect(() => {
    const storedMessages = localStorage.getItem("chatMessages");
    if (storedMessages) {
      setMessage(JSON.parse(storedMessages));
    }
  }, []);

  // Simple mock for useGemini

  async function search(formData) {
    const query = formData.get("query");
    if (!query.trim()) return; // Prevent sending empty messages

    const userMessage = { role: "user", text: query };

    setMessage((prev) => {
      const newState = [...prev, userMessage];
      localStorage.setItem("chatMessages", JSON.stringify(newState));
      return newState;
    });

    try {
      //   const aiResponse = await useGemini(query);
      const aiResponse = "This is a mock response from the AI model."; // Mock response
      const aiMessage = { role: "ai", text: aiResponse };

      setMessage((prev) => {
        const newState = [...prev, aiMessage];
        localStorage.setItem("chatMessages", JSON.stringify(newState));
        return newState;
      });
    } catch (error) {
      console.log("Error fetching AI response:", error);
      // Optionally add an error message to the chat
      setMessage((prev) => {
        const errorMsg = {
          role: "ai",
          text: "Oops! Something went wrong. Please try again.",
        };
        const newState = [...prev, errorMsg];
        localStorage.setItem("chatMessages", JSON.stringify(newState));
        return newState;
      });
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    search(formData);
    e.target.reset();
  };

  return (
    <Card className={"max-w-xl mx-auto"}>
      <CardHeader>
        <CardTitle>Ask For Help</CardTitle>
        <CardDescription>Ask Anything About software</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4 max-h-[60vh] overflow-y-auto border p-2 rounded">
          {messages.map((msg, i) => (
            // This is the flex container for each message bubble
            <div
              key={i}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {/* This is the actual message bubble content */}
              <div
                className={`text-sm p-3 rounded-md max-w-[75%] break-words ${
                  // break-words helps with long text
                  msg.role === "user"
                    ? "bg-blue-500 text-white ml-auto" // User message: blue background, white text, margin-left auto for right alignment
                    : "bg-gray-200 text-gray-800 mr-auto" // AI message: gray background, dark text, margin-right auto for left alignment
                } shadow-md`}
              >
                <strong className="font-semibold text-xs opacity-75">
                  {msg.role === "user" ? "You" : "AI"}:
                </strong>
                <ReactMarkdown>{msg.text}</ReactMarkdown>
              </div>
            </div>
          ))}
          {loading && ( // Loading indicator
            <div className="flex justify-start">
              <div className="text-sm p-3 rounded-xl bg-gray-200 text-gray-800 max-w-[75%] shadow-md">
                <span className="dot-flashing"></span>{" "}
                {/* Simple loading animation */}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            type="text"
            name="query"
            placeholder="Ask me anything..."
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading} // Disable input while loading
          />
          <Button
            type="submit"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading} // Disable button while loading
          >
            {loading ? "Sending..." : "Send"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default ChatComponent;
